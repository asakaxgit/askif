package askif.conformance

import askif.Answer
import askif.AskException
import askif.Backend
import askif.BackendLimits
import askif.ChoiceAnswer
import askif.ChoiceQuestion
import askif.DecisionItem
import askif.ErrorCode
import askif.ItemResult
import askif.Question
import askif.QuestionResult
import askif.ScaleAnswer
import askif.ScaleQuestion
import askif.State
import askif.YesNoAnswer
import askif.YesNoQuestion
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal class ScriptExhausted : RuntimeException("script exhausted")

internal class Scripted(
    override val name: String,
    spec: JsonObject,
    script: JsonObject,
) : Backend {
    private val decideSteps: List<JsonElement> = script.array("decide")
    private val manySteps: List<JsonElement> = script.array("decideMany")
    private var decideCursor: Int = 0
    private var manyCursor: Int = 0
    val decide: MutableList<JsonObject> = mutableListOf()
    val decideMany: MutableList<JsonObject> = mutableListOf()
    var exhausted: Boolean = false

    override val multiState: Boolean = spec.bool("multiState") == true
    override val hasDecideMany: Boolean = spec.bool("hasDecideMany") == true
    override val limits: BackendLimits = limitsOf(spec["limits"])

    override suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult> {
        val step = stepAt(decideSteps, decideCursor)
        decideCursor += 1
        val ids = questions.keys.toList()
        decide += JsonObject(
            mapOf(
                "state" to state,
                "questionCount" to JsonPrimitive(ids.size),
                "questions" to JsonArray(ids.map { id -> questions[id]?.let(::questionJson) ?: kotlinx.serialization.json.JsonNull }),
                "context" to kotlinx.serialization.json.JsonNull,
            ),
        )
        if (step.bool("throw") == true) throw RuntimeException("scripted failure")
        val byKind = step["byKind"] as? JsonObject
        val specs = if (byKind != null) emptyList() else specsFor(step, ids.size)
        val results = linkedMapOf<String, QuestionResult>()
        ids.forEachIndexed { index, id ->
            val question = questions[id]
            val result = if (byKind != null) {
                if (question == null) null else byKindAnswer(question, byKind)
            } else {
                one(specs.getOrNull(index) as? JsonObject)
            }
            if (result != null) results[id] = result
        }
        return results
    }

    override suspend fun decideMany(items: List<DecisionItem>): List<ItemResult> {
        val step = stepAt(manySteps, manyCursor)
        manyCursor += 1
        decideMany += JsonObject(
            mapOf(
                "itemCount" to JsonPrimitive(items.size),
                "items" to JsonArray(
                    items.map { item ->
                        JsonObject(
                            mapOf(
                                "id" to JsonPrimitive(item.id),
                                "state" to item.state,
                                "question" to questionJson(item.question),
                            ),
                        )
                    },
                ),
                "context" to kotlinx.serialization.json.JsonNull,
            ),
        )
        if (step.bool("throw") == true) throw RuntimeException("scripted failure")
        val byKind = step["byKind"] as? JsonObject
        val specs = if (byKind != null) emptyList() else specsFor(step, items.size)
        return items.mapIndexed { index, item ->
            try {
                val result = if (byKind != null) byKindAnswer(item.question, byKind) else one(specs.getOrNull(index) as? JsonObject)
                when (result) {
                    null -> ItemResult.failed(item.id, RuntimeException("missing answer"))
                    is QuestionResult.Failed -> ItemResult.failed(item.id, result.error)
                    is QuestionResult.Answered -> ItemResult.answered(item.id, result.answer)
                }
            } catch (error: Throwable) {
                ItemResult.failed(item.id, error)
            }
        }
    }

    private fun stepAt(steps: List<JsonElement>, cursor: Int): JsonObject {
        val value = steps.getOrNull(cursor)
        if (value !is JsonObject) {
            exhausted = true
            throw ScriptExhausted()
        }
        return value
    }

    private fun specsFor(step: JsonObject, count: Int): List<JsonElement?> {
        val answers = step["answers"]
        if (answers is JsonObject && "each" in answers) {
            val each = answers["each"]
            if (each !is JsonObject) {
                exhausted = true
                throw ScriptExhausted()
            }
            return List(count) { each }
        }
        if (answers !is JsonArray) {
            exhausted = true
            throw ScriptExhausted()
        }
        return answers
    }

    private fun one(spec: JsonObject?): QuestionResult? {
        if (spec == null) return null
        if (spec.bool("throw") == true) throw RuntimeException("item failed")
        val code = spec.string("error")
        if (code != null) {
            val parsed = errorCode(code)
            if (parsed == null) {
                exhausted = true
                throw ScriptExhausted()
            }
            return QuestionResult.failed(AskException(parsed, parsed.name))
        }
        return QuestionResult.answered(answerFrom(spec))
    }

    private fun byKindAnswer(question: Question, byKind: JsonObject): QuestionResult {
        if (question is YesNoQuestion) {
            val table = byKind["yesno"] as? JsonObject ?: exhaust()
            val condition = (question.instructions as? JsonObject)?.string("condition") ?: exhaust()
            val probability = table[condition]?.jsonPrimitive?.doubleOrNull ?: exhaust()
            return QuestionResult.answered(YesNoAnswer(probability))
        }
        if (question is ChoiceQuestion) {
            val table = byKind["choice"] as? JsonObject ?: exhaust()
            val body = table[instructionKey(question.instructions)] as? JsonObject ?: exhaust()
            return QuestionResult.answered(answerFrom(JsonObject(mapOf("kind" to JsonPrimitive("choice")) + body)))
        }
        if (question is ScaleQuestion) {
            val table = byKind["scale"] as? JsonObject ?: exhaust()
            val body = table[instructionKey(question.instructions)] as? JsonObject ?: exhaust()
            return QuestionResult.answered(answerFrom(JsonObject(mapOf("kind" to JsonPrimitive("scale")) + body)))
        }
        exhaust()
    }

    private fun exhaust(): Nothing {
        exhausted = true
        throw ScriptExhausted()
    }
}

internal fun questionJson(question: Question): JsonObject = when (question) {
    is YesNoQuestion -> JsonObject(
        mapOf(
            "kind" to JsonPrimitive("yesno"),
            "instructions" to question.instructions,
            "criteria" to criteriaJson(question.criteria),
        ),
    )
    is ChoiceQuestion -> JsonObject(
        mapOf(
            "kind" to JsonPrimitive("choice"),
            "instructions" to question.instructions,
            "options" to JsonArray(
                question.options.map { option ->
                    JsonObject(mapOf("key" to JsonPrimitive(option.key), "description" to option.description))
                },
            ),
        ),
    )
    is ScaleQuestion -> JsonObject(
        mapOf(
            "kind" to JsonPrimitive("scale"),
            "instructions" to question.instructions,
            "levels" to JsonArray(question.levels),
        ),
    )
}

private fun criteriaJson(criteria: askif.YesNoCriteria?): JsonElement {
    if (criteria == null) return kotlinx.serialization.json.JsonNull
    return JsonObject(
        mapOf(
            "true" to (criteria.yes ?: kotlinx.serialization.json.JsonNull),
            "false" to (criteria.no ?: kotlinx.serialization.json.JsonNull),
        ),
    )
}

private fun answerFrom(spec: JsonObject): Answer {
    when (spec.string("kind")) {
        "yesno" -> return YesNoAnswer(spec["probability"]?.jsonPrimitive?.doubleOrNull ?: error("probability"))
        "choice" -> {
            val probabilities = spec["probabilities"]?.jsonObject ?: error("choice probabilities")
            val parsed = linkedMapOf<String, Double>()
            for ((key, value) in probabilities) {
                parsed[key] = value.jsonPrimitive.doubleOrNull ?: error(key)
            }
            val confidence = spec["confidence"]?.jsonPrimitive?.doubleOrNull
            return ChoiceAnswer(parsed, confidence)
        }
        "scale" -> {
            val values = spec["probabilities"] as? JsonArray ?: error("scale probabilities")
            val confidence = spec["confidence"]?.jsonPrimitive?.doubleOrNull
            return ScaleAnswer(values.map { value -> value.jsonPrimitive.doubleOrNull ?: error("p") }, confidence)
        }
        else -> error("unknown answer kind")
    }
}

private fun limitsOf(raw: JsonElement?): BackendLimits {
    val objectValue = raw as? JsonObject ?: return BackendLimits.NONE
    return BackendLimits(
        maxImages = objectValue.int("maxImages"),
        maxOptions = objectValue.int("maxOptions"),
        maxLevels = objectValue.int("maxLevels"),
        maxQuestionsPerCall = objectValue.int("maxQuestionsPerCall"),
        maxStatesPerCall = objectValue.int("maxStatesPerCall"),
    )
}

private fun errorCode(value: String): ErrorCode? = ErrorCode.entries.firstOrNull { code -> code.name == value }

private fun instructionKey(instructions: JsonElement): String {
    val primitive = instructions as? JsonPrimitive
    if (primitive != null && primitive.isString) return primitive.content
    return kotlinx.serialization.json.Json.encodeToString(JsonElement.serializer(), instructions)
}

internal fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull?.takeIf {
    this[key]?.jsonPrimitive?.isString == true
}

internal fun JsonObject.bool(key: String): Boolean? = this[key]?.jsonPrimitive?.booleanOrNull

internal fun JsonObject.int(key: String): Int? = this[key]?.jsonPrimitive?.intOrNull

internal fun JsonObject.double(key: String): Double? = this[key]?.jsonPrimitive?.doubleOrNull

internal fun JsonObject.array(key: String): List<JsonElement> = (this[key] as? JsonArray)?.toList() ?: emptyList()
