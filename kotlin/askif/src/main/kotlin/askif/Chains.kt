package askif

import java.util.concurrent.CompletableFuture
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

private class ConditionSpec(
    val condition: String,
    val options: IfOptions,
)

/**
 * An `askIf` chain. Methods after `run` or `handle` throw [ErrorCode.CHAIN_STARTED].
 * `orElse` is the else branch. `elseIf` does not inherit criteria.
 */
public class IfChain internal constructor(
    private val ask: Ask,
    private val state: State,
    firstCondition: String,
    firstOptions: IfOptions,
) {
    private val shared: IfOptions = firstOptions.withoutCriteria()
    private val conditions: MutableList<ConditionSpec> = mutableListOf(ConditionSpec(firstCondition, firstOptions))
    private val elseifHandlers: MutableList<Handler<IfElseIfResult>?> = mutableListOf()
    private var thenHandler: Handler<IfThenResult>? = null
    private var elseHandler: Handler<IfElseResult>? = null
    private var unsureHandler: Handler<IfUnsureResult>? = null
    private var unsureMode: UnsureMode = UnsureMode.STOP
    private var started: Boolean = false

    /** Handler for the first condition. */
    public fun then(handler: Handler<IfThenResult>): IfChain {
        touch("then")
        thenHandler = handler
        return this
    }

    /** Another condition. Shared options apply; criteria do not. */
    public fun elseIf(condition: String): IfChain = elseIf(condition, null, IfOptions())

    /** Another condition with a handler. */
    public fun elseIf(condition: String, handler: Handler<IfElseIfResult>?): IfChain =
        elseIf(condition, handler, IfOptions())

    /** Another condition with its own options and no handler. */
    public fun elseIf(condition: String, options: IfOptions): IfChain = elseIf(condition, null, options)

    /** Another condition with a handler and options. */
    public fun elseIf(condition: String, handler: Handler<IfElseIfResult>?, options: IfOptions): IfChain {
        touch("elseif")
        conditions.add(ConditionSpec(condition, shared.overlay(options)))
        elseifHandlers.add(handler)
        return this
    }

    /** Handler for when nothing holds. */
    public fun orElse(handler: Handler<IfElseResult>): IfChain {
        touch("else")
        elseHandler = handler
        return this
    }

    /** Unsure handler. Mode defaults to [UnsureMode.STOP]. */
    public fun unsure(handler: Handler<IfUnsureResult>): IfChain = unsure(handler, UnsureMode.STOP)

    /** Unsure handler with an explicit mode. */
    public fun unsure(handler: Handler<IfUnsureResult>, mode: UnsureMode): IfChain {
        touch("unsure")
        unsureHandler = handler
        unsureMode = mode
        return this
    }

    /** Queue the chain and return without waiting. */
    public fun handle(): Handle<IfResult> {
        val pending = start()
        return spawn { gate ->
            val probabilities = pending.map { handle -> handle.await() }
            judge(probabilities, gate)
        }
    }

    /** Send the chain and suspend until it finishes. Not valid inside an open batch. */
    @JvmSynthetic
    public suspend fun run(): IfResult {
        ask.ensureOutsideBatch()
        val pending = start()
        val probabilities = pending.map { handle -> handle.await() }
        return judge(probabilities, null)
    }

    /** Blocking [run]. */
    @JvmName("run")
    public fun runBlocking(): IfResult {
        ask.ensureOutsideBatch()
        return Runtime.blocking { run() }
    }

    /** [run] as a future. Inside an open batch this joins that batch. */
    public fun runAsync(): CompletableFuture<IfResult> {
        if (batchLocal.get() != null) return handle().toCompletableFuture()
        return Runtime.future { run() }
    }

    private fun start(): List<Handle<Double>> {
        close()
        return ask.enlist {
            conditions.map { spec ->
                val backend = spec.options.backend ?: ask.config().backend
                ask.enqueueProbability(backend, state, spec.condition, spec.options.criteria)
            }
        }
    }

    private fun judge(probabilities: List<Double>, gate: CompletableDeferred<IfResult>?): IfResult {
        val config = ask.config()
        val unsureIndexes = mutableListOf<Int>()
        fun verdict(probability: Double, options: IfOptions): String {
            if (unsureHandler != null) {
                val band = options.unsureBand ?: config.unsureBand
                if (probability > band.high) return "then"
                if (probability < band.low) return "else"
                return "unsure"
            }
            val threshold = options.threshold ?: config.threshold
            return if (probability > threshold) "then" else "else"
        }
        fun snapshot(): List<Int> = unsureIndexes.toList()
        fun deliver(result: IfResult, handler: (() -> Unit)?) {
            if (gate?.isCancelled == true) return
            handler?.invoke()
        }
        fun unsureAt(index: Int): IfResult {
            val spec = conditions[index]
            val result = IfUnsureResult(
                index,
                spec.condition,
                probabilities[index],
                probabilities,
                snapshot(),
            )
            deliver(result) { unsureHandler?.accept(result) }
            return result
        }
        for ((index, spec) in conditions.withIndex()) {
            val probability = probabilities[index]
            val verdict = verdict(probability, spec.options)
            if (verdict == "unsure") {
                unsureIndexes.add(index)
                if (unsureMode == UnsureMode.STOP) return unsureAt(index)
            }
            if (verdict != "then") continue
            if (index == 0) {
                val result = IfThenResult(spec.condition, probability, probabilities, snapshot())
                deliver(result) { thenHandler?.accept(result) }
                return result
            }
            val result = IfElseIfResult(index, spec.condition, probability, probabilities, snapshot())
            deliver(result) { elseifHandlers[index - 1]?.accept(result) }
            return result
        }
        val firstUnsure = unsureIndexes.firstOrNull()
        if (firstUnsure != null) return unsureAt(firstUnsure)
        val result = IfElseResult(probabilities, snapshot())
        deliver(result) { elseHandler?.accept(result) }
        return result
    }

    private fun touch(method: String) {
        if (started) {
            throw AskException(
                ErrorCode.CHAIN_STARTED,
                ".$method() was called after the question was sent.",
            )
        }
    }

    private fun close() {
        if (started) throw AskException(ErrorCode.CHAIN_STARTED, "the question was already sent.")
        started = true
    }
}

private class OptionSpec(
    val key: String,
    val description: kotlinx.serialization.json.JsonElement,
    val handler: Handler<SwitchResult>?,
)

/**
 * An `askSwitch` chain. `option` is the Java-safe name for a case. `other` adds the fallback option.
 */
public class SwitchChain internal constructor(
    private val ask: Ask,
    private val state: State,
    private val question: State,
    private val options: DecisionOptions,
) {
    private val cases: MutableList<OptionSpec> = mutableListOf()
    private var unsureHandler: Handler<SwitchResult>? = null
    private var started: Boolean = false

    /** Add an option whose description is JSON null. */
    public fun option(key: String): SwitchChain = option(key, null, null)

    /** Add an option with a description. */
    public fun option(key: String, description: State): SwitchChain = option(key, description, null)

    /** Add an option with a handler and a null description. */
    public fun option(key: String, handler: Handler<SwitchResult>): SwitchChain = option(key, null, handler)

    /** Add an option. */
    public fun option(key: String, description: State?, handler: Handler<SwitchResult>?): SwitchChain {
        touch("option")
        add(key, description ?: JsonNull, handler)
        return this
    }

    /** Add the `other` option with the default description. */
    public fun other(): SwitchChain = other(null, null)

    /** Add `other` with a description. */
    public fun other(description: State): SwitchChain = other(description, null)

    /** Add `other` with a handler and the default description. */
    public fun other(handler: Handler<SwitchResult>): SwitchChain = other(null, handler)

    /** Add `other`. A null description becomes "None of the other options fit". */
    public fun other(description: State?, handler: Handler<SwitchResult>?): SwitchChain {
        touch("other")
        add("other", description ?: JsonPrimitive(OTHER_DESCRIPTION), handler)
        return this
    }

    /** Run when confidence is below the minimum. */
    public fun unsure(handler: Handler<SwitchResult>): SwitchChain {
        touch("unsure")
        unsureHandler = handler
        return this
    }

    /** Queue the chain and return without waiting. */
    public fun handle(): Handle<SwitchResult> {
        val pending = start()
        return spawn { gate ->
            val answer = pending.await()
            judge(answer, gate)
        }
    }

    /** Send the chain and suspend until it finishes. */
    @JvmSynthetic
    public suspend fun run(): SwitchResult {
        ask.ensureOutsideBatch()
        val answer = start().await()
        return judge(answer, null)
    }

    /** Blocking [run]. */
    @JvmName("run")
    public fun runBlocking(): SwitchResult {
        ask.ensureOutsideBatch()
        return Runtime.blocking { run() }
    }

    /** [run] as a future. */
    public fun runAsync(): CompletableFuture<SwitchResult> {
        if (batchLocal.get() != null) return handle().toCompletableFuture()
        return Runtime.future { run() }
    }

    private fun add(key: String, description: State, handler: Handler<SwitchResult>?) {
        if (cases.any { spec -> spec.key == key }) {
            throw AskException(ErrorCode.INVALID_QUESTION, "Option \"$key\" is declared twice.")
        }
        cases.add(OptionSpec(key, description, handler))
    }

    private fun start(): Handle<Answer> {
        close()
        val backend = ask.backendOf(options)
        checkCount("options", cases.size, backend.limits.maxOptions)
        val question = ChoiceQuestion(
            this.question,
            cases.map { spec -> ChoiceOption(spec.key, spec.description) },
        )
        return ask.enlist { ask.enqueue(backend, state, question) }
    }

    private fun judge(answer: Answer, gate: CompletableDeferred<SwitchResult>?): SwitchResult {
        if (answer !is ChoiceAnswer) throw AskException(ErrorCode.BAD_RESPONSE, "Expected a choice answer.")
        val config = ask.config()
        val ranking = cases
            .map { spec -> Ranked(spec.key, answer.probabilities[spec.key] ?: 0.0) }
            .sortedByDescending { ranked -> ranked.probability }
        val top = ranking.firstOrNull() ?: throw AskException(ErrorCode.BAD_RESPONSE, "The choice answer was empty.")
        val confidence = answer.confidence ?: Decision.confidenceOf(ranking.map { ranked -> ranked.probability })
        val minimum = options.minConfidence ?: config.minConfidence
        val unsure = unsureHandler != null && confidence < minimum
        val result = SwitchResult(
            branch = if (unsure) Branch.UNSURE else Branch.CASE,
            choice = top.key,
            confidence = confidence,
            ranking = ranking,
        )
        if (gate?.isCancelled != true) {
            val handler = if (unsure) unsureHandler else cases.first { spec -> spec.key == top.key }.handler
            handler?.accept(result)
        }
        return result
    }

    private fun touch(method: String) {
        if (started) throw AskException(ErrorCode.CHAIN_STARTED, ".$method() was called after the question was sent.")
    }

    private fun close() {
        if (started) throw AskException(ErrorCode.CHAIN_STARTED, "the question was already sent.")
        started = true
    }
}

private class LevelSpec(
    val key: String,
    val description: State,
    val handler: Handler<ScoreResult>?,
)

/** A `score` chain. Level keys are not sent; a missing description is sent as the key. */
public class ScoreChain internal constructor(
    private val ask: Ask,
    private val state: State,
    private val question: State,
    private val options: DecisionOptions,
) {
    private val levels: MutableList<LevelSpec> = mutableListOf()
    private var unsureHandler: Handler<ScoreResult>? = null
    private var started: Boolean = false

    /** Add a level whose description is the key. */
    public fun level(key: String): ScoreChain = level(key, null, null)

    /** Add a level with a description. */
    public fun level(key: String, description: State): ScoreChain = level(key, description, null)

    /** Add a level with a handler. The description sent is the key. */
    public fun level(key: String, handler: Handler<ScoreResult>): ScoreChain = level(key, null, handler)

    /** Add a level. */
    public fun level(key: String, description: State?, handler: Handler<ScoreResult>?): ScoreChain {
        touch("level")
        if (levels.any { spec -> spec.key == key }) {
            throw AskException(ErrorCode.INVALID_QUESTION, "Level \"$key\" is declared twice.")
        }
        levels.add(LevelSpec(key, description ?: JsonPrimitive(key), handler))
        return this
    }

    /** Run when confidence is below the minimum. */
    public fun unsure(handler: Handler<ScoreResult>): ScoreChain {
        touch("unsure")
        unsureHandler = handler
        return this
    }

    /** Queue the chain and return without waiting. */
    public fun handle(): Handle<ScoreResult> {
        val pending = start()
        return spawn { gate -> judge(pending.await(), gate) }
    }

    /** Send the chain and suspend until it finishes. */
    @JvmSynthetic
    public suspend fun run(): ScoreResult {
        ask.ensureOutsideBatch()
        return judge(start().await(), null)
    }

    /** Blocking [run]. */
    @JvmName("run")
    public fun runBlocking(): ScoreResult {
        ask.ensureOutsideBatch()
        return Runtime.blocking { run() }
    }

    /** [run] as a future. */
    public fun runAsync(): CompletableFuture<ScoreResult> {
        if (batchLocal.get() != null) return handle().toCompletableFuture()
        return Runtime.future { run() }
    }

    private fun start(): Handle<Answer> {
        close()
        val backend = ask.backendOf(options)
        checkCount("levels", levels.size, backend.limits.maxLevels)
        val question = ScaleQuestion(this.question, levels.map { spec -> spec.description })
        return ask.enlist { ask.enqueue(backend, state, question) }
    }

    private fun judge(answer: Answer, gate: CompletableDeferred<ScoreResult>?): ScoreResult {
        if (answer !is ScaleAnswer) throw AskException(ErrorCode.BAD_RESPONSE, "Expected a scale answer.")
        val config = ask.config()
        val probabilities = answer.probabilities
        val index = argmax(probabilities)
        val top = levels.getOrNull(index) ?: throw AskException(ErrorCode.BAD_RESPONSE, "The scale answer was empty.")
        var score = 0.0
        probabilities.forEachIndexed { position, probability -> score += probability * position }
        val confidence = answer.confidence ?: Decision.confidenceOf(probabilities)
        val minimum = options.minConfidence ?: config.minConfidence
        val unsure = unsureHandler != null && confidence < minimum
        val result = ScoreResult(
            branch = if (unsure) Branch.UNSURE else Branch.LEVEL,
            level = top.key,
            index = index,
            score = score,
            normalized = score / (levels.size - 1),
            confidence = confidence,
            probabilities = probabilities,
        )
        if (gate?.isCancelled != true) {
            val handler = if (unsure) unsureHandler else top.handler
            handler?.accept(result)
        }
        return result
    }

    private fun touch(method: String) {
        if (started) throw AskException(ErrorCode.CHAIN_STARTED, ".$method() was called after the question was sent.")
    }

    private fun close() {
        if (started) throw AskException(ErrorCode.CHAIN_STARTED, "the question was already sent.")
        started = true
    }
}

internal fun <T> spawn(block: suspend (CompletableDeferred<T>) -> T): Handle<T> {
    val deferred = CompletableDeferred<T>()
    Runtime.scope.launch {
        try {
            deferred.complete(block(deferred))
        } catch (error: CancellationException) {
            deferred.cancel(error)
        } catch (error: Throwable) {
            deferred.completeExceptionally(error)
        }
    }
    return Handle(deferred)
}
