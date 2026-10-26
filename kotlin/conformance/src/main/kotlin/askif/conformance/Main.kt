package askif.conformance

import askif.Ask
import askif.AskException
import askif.Backend
import askif.Branch
import askif.ConfigPatch
import askif.DecisionOptions
import askif.Handler
import askif.IfElseIfResult
import askif.IfElseResult
import askif.IfOptions
import askif.IfResult
import askif.IfThenResult
import askif.IfUnsureResult
import askif.ScoreResult
import askif.State
import askif.SwitchResult
import askif.UnsureMode
import askif.YesNoCriteria
import kotlin.system.exitProcess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

private class Plan(
    val condition: String,
    val threshold: Double?,
    val band: askif.Band?,
    val criteria: YesNoCriteria?,
)

private class Started(
    val await: (() -> JsonObject)?,
    val handlers: MutableList<String>,
    val late: (() -> Unit)?,
    val failure: Throwable?,
)

fun main() {
    try {
        val text = System.`in`.bufferedReader().readText()
        val root = Json.parseToJsonElement(text) as? JsonObject ?: error("case must be an object")
        if (root.array("calls").isEmpty() && root["calls"] !is JsonArray) error("calls must be an array")
        val output = runCase(root)
        println(Json.encodeToString(JsonElement.serializer(), output))
    } catch (error: ScriptExhausted) {
        System.err.println(error.message)
        exitProcess(2)
    } catch (error: Throwable) {
        error.printStackTrace(System.err)
        exitProcess(1)
    }
}

private fun runCase(root: JsonObject): JsonObject {
    val id = root.string("id") ?: error("id")
    val calls = (root["calls"] as? JsonArray)?.flatMap { element ->
        val call = element as? JsonObject ?: error("call")
        expand(call)
    } ?: error("calls")
    val backendSpec = root["backend"] as? JsonObject ?: JsonObject(emptyMap())
    val script = root["script"] as? JsonObject ?: JsonObject(emptyMap())
    val mainBackend = Scripted("script", backendSpec, script)
    val overrideScript = script["override"] as? JsonObject
    val overrideBackend = if (overrideScript == null) null else Scripted("override", backendSpec, overrideScript)
    val ask = Ask.create(mainBackend, patch(root["config"]))
    val groups = linkedMapOf<Int, MutableList<JsonObject>>()
    for (call in calls) {
        val group = call.int("group") ?: error("group")
        groups.getOrPut(group) { mutableListOf() }.add(call)
    }
    val results = mutableListOf<JsonObject>()
    val handlersRun = mutableListOf<List<String>>()
    for (group in groups.keys.sorted()) {
        val started = mutableListOf<Started>()
        ask.batch {
            for (call in groups.getValue(group)) {
                if (call.string("op") == "configure") {
                    ask.configure(patch(call["configure"]))
                    continue
                }
                try {
                    started += start(ask, call, backendFor(call, overrideBackend))
                } catch (error: Throwable) {
                    started += Started(null, mutableListOf(), null, error)
                }
            }
        }
        for (task in started) {
            val failure = task.failure
            if (failure != null || task.await == null) {
                results += JsonObject(mapOf("error" to JsonPrimitive(codeOf(failure ?: error("missing result")))))
                handlersRun.add(emptyList())
                continue
            }
            try {
                var value = task.await.invoke()
                val late = task.late
                if (late != null) {
                    try {
                        late.invoke()
                    } catch (error: Throwable) {
                        value = JsonObject(value.toMap() + mapOf("afterStartError" to JsonPrimitive(codeOf(error))))
                    }
                }
                results += value
                handlersRun += task.handlers.toList()
            } catch (error: Throwable) {
                results += JsonObject(mapOf("error" to JsonPrimitive(codeOf(error))))
                handlersRun += task.handlers.toList()
            }
        }
    }
    if (mainBackend.exhausted || overrideBackend?.exhausted == true) throw ScriptExhausted()
    return JsonObject(
        mapOf(
            "id" to JsonPrimitive(id),
            "results" to JsonArray(results),
            "handlersRun" to JsonArray(handlersRun.map { names -> JsonArray(names.map { JsonPrimitive(it) }) }),
            "errors" to JsonArray(
                results.map { result ->
                    val code = result.string("error")
                    if (code == null) JsonNull else JsonPrimitive(code)
                },
            ),
            "backendCalls" to JsonPrimitive(mainBackend.decide.size + mainBackend.decideMany.size),
            "decide" to JsonArray(mainBackend.decide),
            "decideMany" to JsonArray(mainBackend.decideMany),
            "overrideDecide" to JsonArray(overrideBackend?.decide ?: emptyList()),
            "overrideDecideMany" to JsonArray(overrideBackend?.decideMany ?: emptyList()),
        ),
    )
}

private fun start(ask: Ask, call: JsonObject, backend: Backend?): Started {
    val op = call.string("op") ?: error("op")
    val ran = mutableListOf<String>()
    val after = call.string("afterStart")
    return when (op) {
        "if" -> startIf(ask, call, backend, ran, after)
        "is" -> {
            val plan = plans(call).first()
            val handle = ask.askIsHandle(stateOf(call), plan.condition, ifOptions(plan, backend))
            Started({ JsonObject(mapOf("value" to JsonPrimitive(handle.awaitBlocking()))) }, ran, null, null)
        }
        "probability" -> {
            val plan = plans(call).first()
            val handle = ask.probabilityHandle(stateOf(call), plan.condition, ifOptions(plan, backend))
            Started({ JsonObject(mapOf("value" to JsonPrimitive(handle.awaitBlocking()))) }, ran, null, null)
        }
        "switch" -> startSwitch(ask, call, backend, ran, after)
        "score" -> startScore(ask, call, backend, ran, after)
        "image", "extractImages" -> error("image ops are deferred on the JVM")
        else -> error("unknown op $op")
    }
}

private fun startIf(ask: Ask, call: JsonObject, backend: Backend?, ran: MutableList<String>, after: String?): Started {
    val handlers = strings(call["handlers"])
    val plans = plans(call)
    val first = plans.first()
    var chain = ask.askIf(stateOf(call), first.condition, ifOptions(first, backend))
    if (handlers.contains("then")) chain = chain.then(Handler { ran.add("then") })
    for (extra in plans.drop(1)) {
        val handler: Handler<IfElseIfResult>? = if (handlers.contains("elseif")) Handler { ran.add("elseif") } else null
        chain = chain.elseIf(extra.condition, handler, ifOptions(extra, null))
    }
    if (handlers.contains("else")) chain = chain.orElse(Handler<IfElseResult> { ran.add("else") })
    if (handlers.contains("unsure")) {
        val mode = if (call.string("unsureMode") == "skip") UnsureMode.SKIP else UnsureMode.STOP
        chain = chain.unsure(Handler<IfUnsureResult> { ran.add("unsure") }, mode)
    }
    val handle = chain.handle()
    val late: (() -> Unit)? = if (after == null) {
        null
    } else {
        {
            when (after) {
                "elseif" -> chain.elseIf("late")
                "else" -> chain.orElse(Handler { })
                "unsure" -> chain.unsure(Handler { })
                else -> error("cannot $after an if chain")
            }
        }
    }
    return Started({ ifJson(handle.awaitBlocking()) }, ran, late, null)
}

private fun startSwitch(ask: Ask, call: JsonObject, backend: Backend?, ran: MutableList<String>, after: String?): Started {
    val handlers = strings(call["handlers"])
    var chain = ask.askSwitch(stateOf(call), call["question"] ?: error("question"), decision(call, backend))
    val options = call["options"] as? JsonArray ?: JsonArray(emptyList())
    for (raw in options) {
        val option = raw as? JsonObject ?: error("option")
        val key = option.string("key") ?: error("key")
        val described = "description" in option
        val description = option["description"]
        if (key == "other") {
            chain = when {
                !described && handlers.contains("other") -> chain.other(Handler { ran.add("other") })
                !described -> chain.other()
                handlers.contains("other") -> chain.other(description ?: JsonNull, Handler { ran.add("other") })
                else -> chain.other(description ?: JsonNull)
            }
        } else {
            chain = when {
                !described && handlers.contains("case") -> chain.option(key, Handler { ran.add("case") })
                !described -> chain.option(key)
                handlers.contains("case") -> chain.option(key, description ?: JsonNull, Handler { ran.add("case") })
                else -> chain.option(key, description ?: JsonNull)
            }
        }
    }
    if (handlers.contains("unsure")) chain = chain.unsure(Handler { ran.add("unsure") })
    val handle = chain.handle()
    val late: (() -> Unit)? = if (after == null) {
        null
    } else {
        {
            when (after) {
                "case" -> chain.option("late")
                "other" -> chain.other()
                "unsure" -> chain.unsure(Handler { })
                else -> error("cannot $after a switch chain")
            }
        }
    }
    return Started({ switchJson(handle.awaitBlocking()) }, ran, late, null)
}

private fun startScore(ask: Ask, call: JsonObject, backend: Backend?, ran: MutableList<String>, after: String?): Started {
    val handlers = strings(call["handlers"])
    var chain = ask.score(stateOf(call), call["question"] ?: error("question"), decision(call, backend))
    val levels = call["levels"] as? JsonArray ?: JsonArray(emptyList())
    for (raw in levels) {
        val level = raw as? JsonObject ?: error("level")
        val key = level.string("key") ?: error("key")
        val described = "description" in level
        val description = level["description"]
        chain = when {
            !described && handlers.contains("level") -> chain.level(key, Handler { ran.add("level") })
            !described -> chain.level(key)
            handlers.contains("level") -> chain.level(key, description ?: JsonNull, Handler { ran.add("level") })
            else -> chain.level(key, description ?: JsonNull)
        }
    }
    if (handlers.contains("unsure")) chain = chain.unsure(Handler { ran.add("unsure") })
    val handle = chain.handle()
    val late: (() -> Unit)? = if (after == null) {
        null
    } else {
        {
            when (after) {
                "level" -> chain.level("late")
                "unsure" -> chain.unsure(Handler { })
                else -> error("cannot $after a score chain")
            }
        }
    }
    return Started({ scoreJson(handle.awaitBlocking()) }, ran, late, null)
}

private fun ifJson(result: IfResult): JsonObject {
    val fields = linkedMapOf<String, JsonElement>(
        "branch" to JsonPrimitive(branchName(result.branch)),
        "probabilities" to JsonArray(result.probabilities.map { JsonPrimitive(it) }),
        "unsureIndexes" to JsonArray(result.unsureIndexes.map { JsonPrimitive(it) }),
        "flags" to JsonNull,
    )
    when (result) {
        is IfThenResult -> {
            fields["index"] = JsonPrimitive(result.index)
            fields["condition"] = JsonPrimitive(result.condition)
            fields["probability"] = JsonPrimitive(result.probability)
        }
        is IfElseIfResult -> {
            fields["index"] = JsonPrimitive(result.index)
            fields["condition"] = JsonPrimitive(result.condition)
            fields["probability"] = JsonPrimitive(result.probability)
        }
        is IfUnsureResult -> {
            fields["index"] = JsonPrimitive(result.index)
            fields["condition"] = JsonPrimitive(result.condition)
            fields["probability"] = JsonPrimitive(result.probability)
        }
        is IfElseResult -> Unit
    }
    return JsonObject(fields)
}

private fun switchJson(result: SwitchResult): JsonObject = JsonObject(
    mapOf(
        "branch" to JsonPrimitive(branchName(result.branch)),
        "choice" to JsonPrimitive(result.choice),
        "confidence" to JsonPrimitive(result.confidence),
        "ranking" to JsonArray(
            result.ranking.map { ranked ->
                JsonObject(mapOf("key" to JsonPrimitive(ranked.key), "probability" to JsonPrimitive(ranked.probability)))
            },
        ),
        "flags" to JsonNull,
    ),
)

private fun scoreJson(result: ScoreResult): JsonObject = JsonObject(
    mapOf(
        "branch" to JsonPrimitive(branchName(result.branch)),
        "level" to JsonPrimitive(result.level),
        "index" to JsonPrimitive(result.index),
        "score" to JsonPrimitive(result.score),
        "normalized" to JsonPrimitive(result.normalized),
        "confidence" to JsonPrimitive(result.confidence),
        "probabilities" to JsonArray(result.probabilities.map { JsonPrimitive(it) }),
        "flags" to JsonNull,
    ),
)

private fun branchName(branch: Branch): String = when (branch) {
    Branch.THEN -> "then"
    Branch.ELSEIF -> "elseif"
    Branch.ELSE -> "else"
    Branch.UNSURE -> "unsure"
    Branch.CASE -> "case"
    Branch.LEVEL -> "level"
}

private fun plans(call: JsonObject): List<Plan> {
    val listed = call["conditions"] as? JsonArray
    if (listed != null) {
        return listed.map { element ->
            val item = element as? JsonObject ?: error("condition")
            Plan(item.string("condition") ?: error("condition"), item.double("threshold"), band(item["unsureBand"]), criteria(item["criteria"]))
        }
    }
    return listOf(
        Plan(call.string("condition") ?: error("condition"), call.double("threshold"), band(call["unsureBand"]), criteria(call["criteria"])),
    )
}

private fun ifOptions(plan: Plan, backend: Backend?): IfOptions {
    var options = IfOptions()
    val threshold = plan.threshold
    val unsure = plan.band
    val criteria = plan.criteria
    if (threshold != null) options = options.threshold(threshold)
    if (unsure != null) options = options.unsureBand(unsure)
    if (criteria != null) options = options.criteria(criteria)
    if (backend != null) options = options.backend(backend)
    return options
}

private fun decision(call: JsonObject, backend: Backend?): DecisionOptions {
    var options = DecisionOptions()
    val minimum = call.double("minConfidence")
    if (minimum != null) options = options.minConfidence(minimum)
    if (backend != null) options = options.backend(backend)
    return options
}

private fun criteria(value: JsonElement?): YesNoCriteria? {
    val objectValue = value as? JsonObject ?: return null
    return YesNoCriteria(objectValue["true"], objectValue["false"])
}

private fun band(value: JsonElement?): askif.Band? {
    val array = value as? JsonArray ?: return null
    return askif.Band(array[0].jsonPrimitive.content.toDouble(), array[1].jsonPrimitive.content.toDouble())
}

private fun patch(value: JsonElement?): ConfigPatch {
    val objectValue = value as? JsonObject ?: return ConfigPatch()
    var patch = ConfigPatch()
    objectValue.double("threshold")?.let { patch = patch.threshold(it) }
    band(objectValue["unsureBand"])?.let { patch = patch.unsureBand(it) }
    objectValue.double("minConfidence")?.let { patch = patch.minConfidence(it) }
    objectValue.int("maxBatchSize")?.let { patch = patch.maxBatchSize(it) }
    objectValue.int("maxStatesPerBatch")?.let { patch = patch.maxStatesPerBatch(it) }
    return patch
}

private fun stateOf(call: JsonObject): State = call["state"] ?: error("state")

private fun backendFor(call: JsonObject, override: Backend?): Backend? =
    if (call.string("backend") == "override") override ?: error("override backend") else null

private fun expand(call: JsonObject): List<JsonObject> {
    val count = call.int("count") ?: return listOf(call)
    return (0 until count).map { index ->
        val fields = call.toMutableMap()
        fields.remove("count")
        fields.remove("statePrefix")
        fields.remove("conditionPrefix")
        val statePrefix = call.string("statePrefix")
        val conditionPrefix = call.string("conditionPrefix")
        if (statePrefix != null) fields["state"] = JsonPrimitive("$statePrefix$index")
        if (conditionPrefix != null) fields["condition"] = JsonPrimitive("$conditionPrefix$index")
        JsonObject(fields)
    }
}

private fun strings(value: JsonElement?): List<String> {
    val array = value as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val primitive = element as? JsonPrimitive
        if (primitive != null && primitive.isString) primitive.content else null
    }
}

private fun codeOf(error: Throwable): String = if (error is AskException) error.code.name else "THROWN"
