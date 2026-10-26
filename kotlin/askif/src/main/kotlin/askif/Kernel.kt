package askif

import kotlin.math.ln

/**
 * 1 minus normalized natural entropy. 1 when one outcome holds all the probability, 0 when it is flat.
 * A single probability is 1. This file does not import `java.*`.
 */
internal fun entropyConfidence(probabilities: List<Double>): Double {
    if (probabilities.size < 2) return 1.0
    var entropy = 0.0
    for (probability in probabilities) {
        if (probability > 0.0) entropy -= probability * ln(probability)
    }
    val value = 1.0 - entropy / ln(probabilities.size.toDouble())
    return minOf(1.0, maxOf(0.0, value))
}

/** Index of the first strict maximum. Ties keep the earlier index. */
internal fun argmax(values: List<Double>): Int {
    var best = 0
    for (index in 1 until values.size) {
        val value = values[index]
        val current = values[best]
        if (value > current) best = index
    }
    return best
}

/** One item in a pack, already carrying the state key the batch map used. */
internal data class PackItem<T>(
    val stateKey: String,
    val imageCount: Int,
    val payload: T,
)

/**
 * Split items the way the TypeScript packer does. A chunk closes when another question would pass
 * [maxQuestions], another state would pass [maxStates], or another state's images would pass
 * [maxImages]. Images count once per distinct state. An empty chunk is never emitted.
 */
internal fun <T> pack(
    items: List<PackItem<T>>,
    maxQuestions: Int,
    maxStates: Int,
    maxImages: Int,
): List<List<PackItem<T>>> {
    val chunks = mutableListOf<List<PackItem<T>>>()
    var current = mutableListOf<PackItem<T>>()
    val states = linkedSetOf<String>()
    var images = 0
    fun close() {
        if (current.isEmpty()) return
        chunks.add(current)
        current = mutableListOf()
        states.clear()
        images = 0
    }
    for (item in items) {
        val seen = item.stateKey in states
        val addsImages = if (seen) 0 else item.imageCount
        val overBudget =
            current.size >= maxQuestions ||
                (!seen && states.size >= maxStates) ||
                (addsImages > 0 && images + addsImages > maxImages)
        if (current.isNotEmpty() && overBudget) close()
        if (item.stateKey !in states) images += item.imageCount
        current.add(item)
        states.add(item.stateKey)
    }
    close()
    return chunks
}

/** First-seen state, then that state's items, in arrival order. */
internal fun <T> groupByState(items: List<PackItem<T>>): List<PackItem<T>> {
    val groups = linkedMapOf<String, MutableList<PackItem<T>>>()
    for (item in items) {
        groups.getOrPut(item.stateKey) { mutableListOf() }.add(item)
    }
    return groups.values.flatten()
}

internal fun checkCount(what: String, count: Int, max: Int?) {
    if (count < 2) {
        throw AskException(ErrorCode.INVALID_QUESTION, "A question needs at least 2 $what, got $count.")
    }
    if (max != null && count > max) {
        throw AskException(ErrorCode.INVALID_QUESTION, "This backend accepts at most $max $what, got $count.")
    }
}
