package askif

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.Json

/** A state is any JSON value. */
public typealias State = JsonElement

/** Build a [State] without a JSON library call at the call site. */
public object States {
    /** A JSON string. */
    @JvmStatic
    public fun of(text: String): State = JsonPrimitive(text)

    /** A JSON integer. */
    @JvmStatic
    public fun of(number: Int): State = JsonPrimitive(number)

    /** A JSON integer. */
    @JvmStatic
    public fun of(number: Long): State = JsonPrimitive(number)

    /** A JSON number. */
    @JvmStatic
    public fun of(number: Double): State = JsonPrimitive(number)

    /** A JSON boolean. */
    @JvmStatic
    public fun of(value: Boolean): State = JsonPrimitive(value)

    /** JSON null. */
    @JvmStatic
    public fun ofNull(): State = JsonNull

    /** Parse one JSON document. */
    @JvmStatic
    public fun parse(json: String): State = Json.parseToJsonElement(json)

    /** A JSON object. Insertion order is kept. */
    @JvmStatic
    public fun obj(entries: Map<String, State>): State = JsonObject(entries)

    /** A JSON array. */
    @JvmStatic
    public fun array(values: List<State>): State = JsonArray(values)
}

/**
 * Yes/no criteria. Java properties are `yes` and `no`; conformance recordings use the wire keys
 * `true` and `false`.
 */
public data class YesNoCriteria @JvmOverloads public constructor(
    /** Text for a yes. */
    public val yes: JsonElement? = null,
    /** Text for a no. */
    public val no: JsonElement? = null,
)

/** A question the backend is asked. */
public sealed interface Question {
    /** `yesno`, `choice`, or `scale`. */
    public val kind: String
}

/** A yes/no question. */
public data class YesNoQuestion @JvmOverloads public constructor(
    /** Claim shown to the model. */
    public val instructions: JsonElement,
    /** Optional yes/no wording. */
    public val criteria: YesNoCriteria? = null,
) : Question {
    override val kind: String get() = "yesno"
}

/** One choice option. `description` is JSON null when the key stands alone. */
public data class ChoiceOption public constructor(
    /** Option key sent to the model and returned on the result. */
    public val key: String,
    /** Option wording. JSON null when omitted. */
    public val description: JsonElement,
)

/** A single-choice question. */
public data class ChoiceQuestion public constructor(
    /** Question shown to the model. */
    public val instructions: JsonElement,
    /** Options in declaration order. */
    public val options: List<ChoiceOption>,
) : Question {
    override val kind: String get() = "choice"
}

/** An ordered scale. */
public data class ScaleQuestion public constructor(
    /** Question shown to the model. */
    public val instructions: JsonElement,
    /** Level wording from low to high. */
    public val levels: List<JsonElement>,
) : Question {
    override val kind: String get() = "scale"
}

/** An answer, matched to a [Question] by kind. */
public sealed interface Answer

/** Yes/no probability, from 0 to 1. */
public data class YesNoAnswer public constructor(
    /** Probability that the answer is yes. */
    public val probability: Double,
) : Answer

/** Probabilities keyed by option. */
public data class ChoiceAnswer @JvmOverloads public constructor(
    /** Probability per option key. Missing keys are treated as 0. */
    public val probabilities: Map<String, Double>,
    /** Backend-reported confidence. Computed when null. */
    public val confidence: Double? = null,
) : Answer

/** Probabilities in level order. */
public data class ScaleAnswer @JvmOverloads public constructor(
    /** Probability per level, low to high. */
    public val probabilities: List<Double>,
    /** Backend-reported confidence. Computed when null. */
    public val confidence: Double? = null,
) : Answer

/** Which branch a chain took. */
public enum class Branch {
    /** The `askIf` condition held. */
    THEN,

    /** An `elseIf` condition held. */
    ELSEIF,

    /** No condition held. */
    ELSE,

    /** The probability or confidence was not decisive. */
    UNSURE,

    /** A switch option won. */
    CASE,

    /** A score level won. */
    LEVEL,
}

/** What the first unsure condition does to the rest of an `elseIf` chain. */
public enum class UnsureMode {
    /** Stop at the first unsure condition. */
    STOP,

    /** Skip unsure conditions. A later clear match can still win. */
    SKIP,
}

/** One ranked option, most likely first after sorting. */
public data class Ranked public constructor(
    /** Option key. */
    public val key: String,
    /** Probability of that option. */
    public val probability: Double,
)

/** Shared fields of an `askIf` result. */
public sealed interface IfResult {
    /** Branch that won. */
    public val branch: Branch

    /** Probability of every condition, in order. */
    public val probabilities: List<Double>

    /** Indexes judged unsure. */
    public val unsureIndexes: List<Int>
}

/** The first condition held. */
public data class IfThenResult public constructor(
    /** The condition text. */
    public val condition: String,
    /** Probability of that condition. */
    public val probability: Double,
    override val probabilities: List<Double>,
    override val unsureIndexes: List<Int>,
) : IfResult {
    override val branch: Branch get() = Branch.THEN

    /** Always 0. */
    public val index: Int get() = 0
}

/** An `elseIf` condition held. */
public data class IfElseIfResult public constructor(
    /** Position of the winning `elseIf`, starting at 1. */
    public val index: Int,
    /** The condition text. */
    public val condition: String,
    /** Probability of that condition. */
    public val probability: Double,
    override val probabilities: List<Double>,
    override val unsureIndexes: List<Int>,
) : IfResult {
    override val branch: Branch get() = Branch.ELSEIF
}

/** No condition held. */
public data class IfElseResult public constructor(
    override val probabilities: List<Double>,
    override val unsureIndexes: List<Int>,
) : IfResult {
    override val branch: Branch get() = Branch.ELSE
}

/** A condition fell in the unsure band. */
public data class IfUnsureResult public constructor(
    /** Index of the unsure condition. */
    public val index: Int,
    /** The condition text. */
    public val condition: String,
    /** Probability of that condition. */
    public val probability: Double,
    override val probabilities: List<Double>,
    override val unsureIndexes: List<Int>,
) : IfResult {
    override val branch: Branch get() = Branch.UNSURE
}

/** Result of `askSwitch`. */
public data class SwitchResult public constructor(
    /** `CASE` or `UNSURE`. */
    public val branch: Branch,
    /** Most likely option. */
    public val choice: String,
    /** Reported or computed confidence. */
    public val confidence: Double,
    /** Every option, most likely first. Ties keep declaration order. */
    public val ranking: List<Ranked>,
)

/** Result of `score`. */
public data class ScoreResult public constructor(
    /** `LEVEL` or `UNSURE`. */
    public val branch: Branch,
    /** Key of the most likely level. */
    public val level: String,
    /** Index of [level]. */
    public val index: Int,
    /** Probability-weighted index. */
    public val score: Double,
    /** [score] divided by `levels - 1`. */
    public val normalized: Double,
    /** Reported or computed confidence. */
    public val confidence: Double,
    /** Probability per level, in order. */
    public val probabilities: List<Double>,
)

/** Synchronous handler. Async handlers are not in 0.1. */
public fun interface Handler<T> {
    /** Accept the winning result. */
    public fun accept(result: T)
}
