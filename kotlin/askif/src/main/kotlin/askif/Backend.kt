package askif

import java.util.concurrent.CompletableFuture
import kotlinx.coroutines.future.await

/** One `(state, question)` pair inside `decideMany`. */
public data class DecisionItem public constructor(
    /** Id echoed on the matching [ItemResult]. */
    public val id: String,
    /** State this question is about. */
    public val state: State,
    /** Question to answer. */
    public val question: Question,
)

/** One question's outcome from `decide`. */
public sealed interface QuestionResult {
    /** A usable answer. */
    public data class Answered public constructor(
        /** The answer. */
        public val answer: Answer,
    ) : QuestionResult

    /** This question failed. Siblings still resolve. */
    public data class Failed public constructor(
        /** Cause. An [AskException] keeps its code; anything else becomes [ErrorCode.BAD_RESPONSE]. */
        public val error: Throwable,
    ) : QuestionResult

    public companion object {
        /** An answered result. */
        @JvmStatic
        public fun answered(answer: Answer): QuestionResult = Answered(answer)

        /** A failed result. */
        @JvmStatic
        public fun failed(error: Throwable): QuestionResult = Failed(error)
    }
}

/** One item's outcome from `decideMany`. */
public sealed interface ItemResult {
    /** Id from the request. */
    public val id: String

    /** A usable answer. */
    public data class Answered public constructor(
        override val id: String,
        /** The answer. */
        public val answer: Answer,
    ) : ItemResult

    /** This item failed. */
    public data class Failed public constructor(
        override val id: String,
        /** Cause. An [AskException] keeps its code. */
        public val error: Throwable,
    ) : ItemResult

    public companion object {
        /** An answered item. */
        @JvmStatic
        public fun answered(id: String, answer: Answer): ItemResult = Answered(id, answer)

        /** A failed item. */
        @JvmStatic
        public fun failed(id: String, error: Throwable): ItemResult = Failed(id, error)
    }
}

/**
 * Kotlin backend. Suspend methods are hidden from Java; implement [JavaBackend] instead.
 * `hasDecideMany` is separate from `multiState`: both must be true before several states share a call.
 */
public interface Backend {
    /** Name used in error messages. */
    public val name: String

    /** Advertised caps. */
    public val limits: BackendLimits get() = BackendLimits.NONE

    /** When true, and [hasDecideMany] is true, several states may share one call. */
    public val multiState: Boolean get() = false

    /** When true, [decideMany] may be called. Ignored unless [multiState] is also true. */
    public val hasDecideMany: Boolean get() = false

    /** Answer every question about one state. Keys in the result match `questions`. */
    @JvmSynthetic
    public suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult>

    /** Answer items that may span states. Throw only when the whole call failed. */
    @JvmSynthetic
    public suspend fun decideMany(items: List<DecisionItem>): List<ItemResult> {
        throw UnsupportedOperationException("$name does not implement decideMany")
    }
}

/**
 * Java backend. `decideAsync` returns a future; the core awaits it.
 * A per-question failure is a [QuestionResult.Failed], not a failed future.
 */
public abstract class JavaBackend public constructor(
    private val backendName: String,
) : Backend {
    private var multi: Boolean = false
    private var many: Boolean = false
    private var limitsValue: BackendLimits = BackendLimits.NONE

    final override val name: String get() = backendName
    final override val multiState: Boolean get() = multi
    final override val hasDecideMany: Boolean get() = many
    final override val limits: BackendLimits get() = limitsValue

    /** Opt into cross-state batches. */
    public fun setMultiState(value: Boolean): JavaBackend {
        multi = value
        return this
    }

    /** Opt into `decideMany`. */
    public fun setHasDecideMany(value: Boolean): JavaBackend {
        many = value
        return this
    }

    /** Replace advertised caps. */
    public fun setLimits(value: BackendLimits): JavaBackend {
        limitsValue = value
        return this
    }

    /** Answer one state. Wildcards are suppressed so a Java override matches `Map<String, Question>`. */
    public abstract fun decideAsync(
        state: State,
        questions: Map<String, @JvmSuppressWildcards Question>,
    ): CompletableFuture<Map<String, @JvmSuppressWildcards QuestionResult>>

    /** Answer many states. The default fails the future. */
    public open fun decideManyAsync(
        items: List<@JvmSuppressWildcards DecisionItem>,
    ): CompletableFuture<List<@JvmSuppressWildcards ItemResult>> =
        CompletableFuture.failedFuture(UnsupportedOperationException("$name does not implement decideMany"))

    final override suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult> =
        decideAsync(state, questions).await()

    final override suspend fun decideMany(items: List<DecisionItem>): List<ItemResult> =
        decideManyAsync(items).await()
}
