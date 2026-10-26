package askif

import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal class Pending(
    val backend: Backend,
    val state: State,
    val stateKey: String,
    val question: Question,
    val imageCount: Int,
    val deferred: CompletableDeferred<Answer>,
) {
    fun fail(error: Throwable) {
        if (error is CancellationException) deferred.cancel(error) else deferred.completeExceptionally(error)
    }

    fun accept(result: QuestionResult?) {
        when (result) {
            null -> fail(badResponse(backend, question, null))
            is QuestionResult.Failed -> {
                val cause = result.error
                if (cause is AskException) fail(cause) else fail(badResponse(backend, question, cause))
            }
            is QuestionResult.Answered -> {
                val answer = result.answer
                if (!kindMatches(question, answer)) {
                    fail(badResponse(backend, question, null))
                    return
                }
                if (question is ScaleQuestion && answer is ScaleAnswer && answer.probabilities.size != question.levels.size) {
                    fail(
                        AskException(
                            ErrorCode.BAD_RESPONSE,
                            "Expected ${question.levels.size} level probabilities, got ${answer.probabilities.size}.",
                        ),
                    )
                    return
                }
                deferred.complete(answer)
            }
        }
    }
}

private fun kindMatches(question: Question, answer: Answer): Boolean = when (question) {
    is YesNoQuestion -> answer is YesNoAnswer
    is ChoiceQuestion -> answer is ChoiceAnswer
    is ScaleQuestion -> answer is ScaleAnswer
}

private fun badResponse(backend: Backend, question: Question, cause: Throwable?): AskException =
    AskException(
        ErrorCode.BAD_RESPONSE,
        "The ${backend.name} backend returned no ${question.kind} answer for a question.",
        cause,
    )

internal const val OTHER_DESCRIPTION: String = "None of the other options fit"

internal fun yesNoQuestion(condition: String, criteria: YesNoCriteria?): YesNoQuestion {
    val instructions: JsonObject = buildJsonObject {
        put("condition", condition)
        put("question", "Is `condition` true of the state?")
    }
    return YesNoQuestion(instructions, criteria)
}

/**
 * One configured askif instance. Calls outside a batch are a batch of one.
 * A batch may span states; packing rules still apply.
 */
public class Ask internal constructor(
    initial: RuntimeConfig,
) {
    private val configRef: AtomicReference<RuntimeConfig> = AtomicReference(initial)

    internal fun config(): RuntimeConfig = configRef.get()

    public companion object {
        /** An instance on [backend] with the spec defaults. */
        @JvmStatic
        public fun create(backend: Backend): Ask = Ask(RuntimeConfig(backend = backend))

        /** An instance on [backend], then [patch]. */
        @JvmStatic
        public fun create(backend: Backend, patch: ConfigPatch): Ask {
            val ask = create(backend)
            ask.configure(patch)
            return ask
        }
    }

    /**
     * Run [block] as one batch and submit when it returns. The block must not wait; use [Handle].
     * Returns whatever [block] returns, after the batch has been submitted.
     */
    public fun <R> batch(block: Ask.() -> R): R {
        if (batchLocal.get() != null) throw IllegalStateException("a batch is already open on this thread")
        val open = OpenBatch(this)
        batchLocal.set(open)
        try {
            return this.block()
        } finally {
            if (batchLocal.get() === open) batchLocal.remove()
            flush(open)
        }
    }

    /** Same as [batch], with [state] fixed so conditions do not repeat it. */
    public fun <R> batch(state: State, block: BoundBatch.() -> R): R = batch { BoundBatch(this, state).block() }

    /** Java batch. Call [Batch.submit] after queueing handles. */
    public fun openBatch(): Batch {
        if (batchLocal.get() != null) throw IllegalStateException("a batch is already open on this thread")
        val open = OpenBatch(this)
        batchLocal.set(open)
        return Batch(open)
    }

    /** Replace defaults. Concurrent with in-flight batches; a batch reads this when it submits and when it judges. */
    public fun configure(patch: ConfigPatch) {
        configRef.updateAndGet { current -> patch.merged(current) }
    }

    /** Kotlin form of [configure]. Hidden from Java. */
    @JvmSynthetic
    public fun configure(block: ConfigPatch.() -> Unit) {
        val patch = ConfigPatch()
        patch.block()
        configure(patch)
    }

    /** Start an if/elseIf chain. Nothing is sent until `run` or `handle`. */
    @JvmOverloads
    public fun askIf(state: State, condition: String, options: IfOptions = IfOptions()): IfChain =
        IfChain(this, state, condition, options)

    /** Start a switch. The builder method is `option`, not `case`. */
    @JvmOverloads
    public fun askSwitch(state: State, question: State, options: DecisionOptions = DecisionOptions()): SwitchChain =
        SwitchChain(this, state, question, options)

    /** Start a score. */
    @JvmOverloads
    public fun score(state: State, question: State, options: DecisionOptions = DecisionOptions()): ScoreChain =
        ScoreChain(this, state, question, options)

    /** True when the yes/no probability is strictly above the threshold. */
    @JvmSynthetic
    public suspend fun askIs(state: State, condition: String, options: IfOptions = IfOptions()): Boolean {
        ensureOutsideBatch()
        val pending = enlist { enqueueProbability(backendOf(options), state, condition, options.criteria) }
        val probability = pending.await()
        val threshold = options.threshold ?: config().threshold
        return probability > threshold
    }

    /** Blocking [askIs]. Hops to an `askif-blocking` thread. */
    @JvmOverloads
    @JvmName("askIs")
    public fun askIsBlocking(state: State, condition: String, options: IfOptions = IfOptions()): Boolean {
        ensureOutsideBatch()
        return Runtime.blocking { askIs(state, condition, options) }
    }

    /** [askIs] as a future. Inside an open batch this joins that batch. */
    @JvmOverloads
    public fun askIsAsync(state: State, condition: String, options: IfOptions = IfOptions()): java.util.concurrent.CompletableFuture<Boolean> {
        if (batchLocal.get() != null) return askIsHandle(state, condition, options).toCompletableFuture()
        return Runtime.future { askIs(state, condition, options) }
    }

    /** Queue `askIs` and return without waiting. Submits immediately when no batch is open. */
    @JvmOverloads
    public fun askIsHandle(state: State, condition: String, options: IfOptions = IfOptions()): Handle<Boolean> {
        val pending = enlist { enqueueProbability(backendOf(options), state, condition, options.criteria) }
        val deferred = CompletableDeferred<Boolean>()
        Runtime.scope.launch {
            try {
                val probability = pending.await()
                if (!deferred.isCancelled) {
                    val threshold = options.threshold ?: config().threshold
                    deferred.complete(probability > threshold)
                }
            } catch (error: CancellationException) {
                deferred.cancel(error)
            } catch (error: Throwable) {
                deferred.completeExceptionally(error)
            }
        }
        return Handle(deferred)
    }

    /** Yes/no probability, from 0 to 1. */
    @JvmSynthetic
    public suspend fun probability(state: State, condition: String, options: IfOptions = IfOptions()): Double {
        ensureOutsideBatch()
        val pending = enlist { enqueueProbability(backendOf(options), state, condition, options.criteria) }
        return pending.await()
    }

    /** Blocking [probability]. */
    @JvmOverloads
    @JvmName("probability")
    public fun probabilityBlocking(state: State, condition: String, options: IfOptions = IfOptions()): Double {
        ensureOutsideBatch()
        return Runtime.blocking { probability(state, condition, options) }
    }

    /** [probability] as a future. */
    @JvmOverloads
    public fun probabilityAsync(state: State, condition: String, options: IfOptions = IfOptions()): java.util.concurrent.CompletableFuture<Double> {
        if (batchLocal.get() != null) return probabilityHandle(state, condition, options).toCompletableFuture()
        return Runtime.future { probability(state, condition, options) }
    }

    /** Queue `probability` and return without waiting. */
    @JvmOverloads
    public fun probabilityHandle(state: State, condition: String, options: IfOptions = IfOptions()): Handle<Double> =
        enlist { enqueueProbability(backendOf(options), state, condition, options.criteria) }

    internal fun ensureOutsideBatch() {
        if (batchLocal.get() != null) {
            throw IllegalStateException("waiting inside an open batch; use a handle and submit first")
        }
    }

    internal fun backendOf(options: IfOptions): Backend = options.backend ?: config().backend

    internal fun backendOf(options: DecisionOptions): Backend = options.backend ?: config().backend

    internal fun <T> enlist(block: () -> T): T {
        if (batchLocal.get() != null) return block()
        val open = OpenBatch(this)
        batchLocal.set(open)
        try {
            return block()
        } finally {
            batchLocal.set(null)
            flush(open)
        }
    }

    internal fun enqueue(backend: Backend, state: State, question: Question): Handle<Answer> {
        val open = batchLocal.get() ?: throw IllegalStateException("enqueue outside a batch")
        val deferred = CompletableDeferred<Answer>()
        // imageCount stays 0 until the image slice. The packer still receives maxImages.
        open.items.add(Pending(backend, state, stateKey(state), question, 0, deferred))
        return Handle(deferred)
    }

    internal fun enqueueProbability(
        backend: Backend,
        state: State,
        condition: String,
        criteria: YesNoCriteria?,
    ): Handle<Double> {
        val answer = enqueue(backend, state, yesNoQuestion(condition, criteria))
        val deferred = CompletableDeferred<Double>()
        Runtime.scope.launch {
            try {
                val value = answer.await()
                if (value !is YesNoAnswer) {
                    throw AskException(ErrorCode.BAD_RESPONSE, "Expected a yes/no answer.")
                }
                deferred.complete(value.probability)
            } catch (error: CancellationException) {
                deferred.cancel(error)
            } catch (error: Throwable) {
                deferred.completeExceptionally(error)
            }
        }
        return Handle(deferred)
    }

    internal fun flush(open: OpenBatch) {
        if (open.submitted) return
        open.submitted = true
        val config = config()
        val byBackend = linkedMapOf<Backend, MutableList<Pending>>()
        for (item in open.items) {
            byBackend.getOrPut(item.backend) { mutableListOf() }.add(item)
        }
        val sends = mutableListOf<suspend () -> Unit>()
        for ((backend, pending) in byBackend) {
            val grouped = groupByState(pending.map { item -> PackItem(item.stateKey, item.imageCount, item) })
            val maxQuestions = questionLimit(backend, config)
            val maxStates = stateLimit(backend, config)
            val maxImages = backend.limits.maxImages ?: 0
            val many = maxStates > 1 && backend.hasDecideMany
            for (chunk in pack(grouped, maxQuestions, maxStates, maxImages)) {
                val items = chunk.map { item -> item.payload }
                val distinct = items.map { item -> item.stateKey }.toSet()
                if (many && distinct.size >= 2) {
                    sends += { sendMany(backend, items) }
                } else {
                    sends += { send(backend, items.first().state, items) }
                }
            }
        }
        if (sends.isEmpty()) return
        // One coroutine, in pack order. TypeScript starts each call on the same turn, so a scripted
        // backend sees decide 0 before decide 1. Parallel dispatchers do not.
        Runtime.scope.launch {
            for (send in sends) send()
        }
    }

    private fun questionLimit(backend: Backend, config: RuntimeConfig): Int {
        val cap = backend.limits.maxQuestionsPerCall ?: Int.MAX_VALUE
        return maxOf(1, minOf(config.maxBatchSize, cap))
    }

    private fun stateLimit(backend: Backend, config: RuntimeConfig): Int {
        if (!backend.multiState || !backend.hasDecideMany) return 1
        val cap = backend.limits.maxStatesPerCall ?: Int.MAX_VALUE
        return maxOf(1, minOf(config.maxStatesPerBatch, cap))
    }

    private suspend fun send(backend: Backend, state: State, items: List<Pending>) {
        try {
            val questions = linkedMapOf<String, Question>()
            items.forEachIndexed { index, item -> questions["q$index"] = item.question }
            val answers = backend.decide(state, questions)
            items.forEachIndexed { index, item -> item.accept(answers["q$index"]) }
        } catch (error: CancellationException) {
            items.forEach { item -> item.fail(error) }
        } catch (error: Throwable) {
            val wrapped = wrapCall(backend, error)
            items.forEach { item -> item.fail(wrapped) }
        }
    }

    private suspend fun sendMany(backend: Backend, items: List<Pending>) {
        try {
            val payload = items.mapIndexed { index, item -> DecisionItem("q$index", item.state, item.question) }
            val results = backend.decideMany(payload)
            val byId = results.associateBy { result -> result.id }
            items.forEachIndexed { index, item ->
                when (val result = byId["q$index"]) {
                    null -> item.accept(null)
                    is ItemResult.Answered -> item.accept(QuestionResult.answered(result.answer))
                    is ItemResult.Failed -> item.accept(QuestionResult.failed(result.error))
                }
            }
        } catch (error: CancellationException) {
            items.forEach { item -> item.fail(error) }
        } catch (error: Throwable) {
            val wrapped = wrapCall(backend, error)
            items.forEach { item -> item.fail(wrapped) }
        }
    }
}

private fun wrapCall(backend: Backend, error: Throwable): Throwable =
    if (error is AskException) {
        error
    } else {
        AskException(ErrorCode.BACKEND_FAILED, "The ${backend.name} backend failed.", error)
    }

/** A Java-opened batch. [submit] sends every handle queued on this thread since [Ask.openBatch]. */
public class Batch internal constructor(
    private val open: OpenBatch,
) {
    /** Send the queued calls. */
    public fun submit() {
        open.detach()
        open.ask.flush(open)
    }
}

/** Calls bound to one state inside [Ask.batch]. */
public class BoundBatch internal constructor(
    private val ask: Ask,
    private val state: State,
) {
    /** `askIf` for the bound state. */
    @JvmOverloads
    public fun askIf(condition: String, options: IfOptions = IfOptions()): IfChain = ask.askIf(state, condition, options)

    /** Handle for `askIs` on the bound state. Does not wait. */
    @JvmOverloads
    public fun askIs(condition: String, options: IfOptions = IfOptions()): Handle<Boolean> =
        ask.askIsHandle(state, condition, options)

    /** Handle for `probability` on the bound state. */
    @JvmOverloads
    public fun probability(condition: String, options: IfOptions = IfOptions()): Handle<Double> =
        ask.probabilityHandle(state, condition, options)

    /** `askSwitch` for the bound state. */
    @JvmOverloads
    public fun askSwitch(question: State, options: DecisionOptions = DecisionOptions()): SwitchChain =
        ask.askSwitch(state, question, options)

    /** `score` for the bound state. */
    @JvmOverloads
    public fun score(question: State, options: DecisionOptions = DecisionOptions()): ScoreChain =
        ask.score(state, question, options)
}
