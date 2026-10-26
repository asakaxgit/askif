package askif

import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.future.future
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

internal object Runtime {
    private val blockingPool = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "askif-blocking").apply { isDaemon = true }
    }
    internal val blocking = blockingPool.asCoroutineDispatcher()
    internal val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    internal fun <T> blocking(block: suspend () -> T): T {
        val name = Thread.currentThread().name
        if (name.startsWith("askif-blocking")) {
            throw IllegalStateException("blocking askif call on thread $name")
        }
        return runBlocking(blocking) { block() }
    }

    internal fun <T> future(block: suspend () -> T): CompletableFuture<T> = scope.future { block() }
}

/** One call inside an open batch. Not visible to Java. */
internal class OpenBatch(
    val ask: Ask,
) {
    val items: MutableList<Pending> = mutableListOf()
    var submitted: Boolean = false

    fun detach() {
        if (batchLocal.get() === this) batchLocal.remove()
    }
}

internal val batchLocal = ThreadLocal<OpenBatch?>()

internal fun stateKey(state: State): String = Json.encodeToString(JsonElement.serializer(), state)

/**
 * A single call's result. [cancel] completes this handle only; the batch's `decide` still runs.
 */
public class Handle<T> internal constructor(
    internal val deferred: CompletableDeferred<T>,
) {
    /** Suspend until the call finishes. */
    @JvmSynthetic
    public suspend fun await(): T = deferred.await()

    /** Block until the call finishes, on an `askif-blocking` thread. */
    @JvmName("await")
    public fun awaitBlocking(): T = Runtime.blocking { deferred.await() }

    /** Future that completes on the runtime dispatcher. */
    public fun toCompletableFuture(): CompletableFuture<T> = Runtime.scope.future { deferred.await() }

    /** Cancel this handle. Sibling handles are not cancelled. */
    public fun cancel(): Unit {
        deferred.cancel(kotlinx.coroutines.CancellationException("cancelled"))
    }
}

/** 1 minus normalized natural entropy. Exposed here so Java does not see a `*Kt` class. */
public object Decision {
    /**
     * Confidence of a distribution. 1 when one outcome has all the mass, 0 when it is uniform.
     * Uses the natural log.
     */
    @JvmStatic
    public fun confidenceOf(probabilities: List<Double>): Double = entropyConfidence(probabilities)
}
