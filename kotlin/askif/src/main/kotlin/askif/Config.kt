package askif

/** Inclusive unsure band. `low <= p <= high` is unsure when a handler is attached. */
public data class Band public constructor(
    /** Lower edge, inclusive. */
    public val low: Double,
    /** Upper edge, inclusive. */
    public val high: Double,
)

/**
 * Caps a backend advertises. Null means "no cap of this kind".
 * `maxImages` is read by the packer; 0.1 always passes an image count of 0.
 */
public data class BackendLimits @JvmOverloads public constructor(
    /** Most images in one state. Null means none are accepted, once images exist. */
    public val maxImages: Int? = null,
    /** Most choice options. */
    public val maxOptions: Int? = null,
    /** Most scale levels. */
    public val maxLevels: Int? = null,
    /** Most questions in one call. */
    public val maxQuestionsPerCall: Int? = null,
    /** Most distinct states in one call, when `multiState` is on. */
    public val maxStatesPerCall: Int? = null,
) {
    public companion object {
        /** No advertised caps. */
        @JvmField
        public val NONE: BackendLimits = BackendLimits()
    }
}

internal data class RuntimeConfig(
    val backend: Backend,
    val threshold: Double = 0.5,
    val unsureBand: Band = Band(0.2, 0.8),
    val minConfidence: Double = 0.5,
    val maxBatchSize: Int = 32,
    val maxStatesPerBatch: Int = 16,
)

/** Partial update for [Ask.configure]. Fields left unset keep the current value. */
public class ConfigPatch {
    private var threshold: Double? = null
    private var unsureBand: Band? = null
    private var minConfidence: Double? = null
    private var maxBatchSize: Int? = null
    private var maxStatesPerBatch: Int? = null
    private var backend: Backend? = null

    /** Replace the threshold. */
    public fun threshold(value: Double): ConfigPatch = apply { threshold = value }

    /** Replace the unsure band. */
    public fun unsureBand(value: Band): ConfigPatch = apply { unsureBand = value }

    /** Replace the minimum confidence. */
    public fun minConfidence(value: Double): ConfigPatch = apply { minConfidence = value }

    /** Replace the question batch cap. */
    public fun maxBatchSize(value: Int): ConfigPatch = apply { maxBatchSize = value }

    /** Replace the state batch cap. */
    public fun maxStatesPerBatch(value: Int): ConfigPatch = apply { maxStatesPerBatch = value }

    /** Replace the instance backend. */
    public fun backend(value: Backend): ConfigPatch = apply { backend = value }

    internal fun merged(base: RuntimeConfig): RuntimeConfig = base.copy(
        backend = backend ?: base.backend,
        threshold = threshold ?: base.threshold,
        unsureBand = unsureBand ?: base.unsureBand,
        minConfidence = minConfidence ?: base.minConfidence,
        maxBatchSize = maxBatchSize ?: base.maxBatchSize,
        maxStatesPerBatch = maxStatesPerBatch ?: base.maxStatesPerBatch,
    )
}

/** Options for one yes/no condition. */
public class IfOptions public constructor(
    /** Overrides the configured threshold when set. */
    public val threshold: Double?,
    /** Overrides the configured band when set. */
    public val unsureBand: Band?,
    /** Yes/no wording. Not inherited by `elseIf`. */
    public val criteria: YesNoCriteria?,
    /** Backend for this condition. */
    public val backend: Backend?,
) {
    /** No overrides. */
    public constructor() : this(null, null, null, null)

    /** Set the threshold. */
    public fun threshold(value: Double): IfOptions = IfOptions(value, unsureBand, criteria, backend)

    /** Set the band. */
    public fun unsureBand(value: Band): IfOptions = IfOptions(threshold, value, criteria, backend)

    /** Set the criteria. */
    public fun criteria(value: YesNoCriteria): IfOptions = IfOptions(threshold, unsureBand, value, backend)

    /** Set the backend. */
    public fun backend(value: Backend): IfOptions = IfOptions(threshold, unsureBand, criteria, value)

    internal fun withoutCriteria(): IfOptions = IfOptions(threshold, unsureBand, null, backend)

    internal fun overlay(extra: IfOptions): IfOptions = IfOptions(
        extra.threshold ?: threshold,
        extra.unsureBand ?: unsureBand,
        extra.criteria ?: criteria,
        extra.backend ?: backend,
    )
}

/** Options for `askSwitch` and `score`. */
public class DecisionOptions public constructor(
    /** Overrides the configured minimum confidence when set. */
    public val minConfidence: Double?,
    /** Backend for this call. */
    public val backend: Backend?,
) {
    /** No overrides. */
    public constructor() : this(null, null)

    /** Set the minimum confidence. */
    public fun minConfidence(value: Double): DecisionOptions = DecisionOptions(value, backend)

    /** Set the backend. */
    public fun backend(value: Backend): DecisionOptions = DecisionOptions(minConfidence, value)
}
