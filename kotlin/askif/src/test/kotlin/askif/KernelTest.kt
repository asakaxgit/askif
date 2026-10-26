package askif

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KernelTest {
    @Test
    fun confidenceIsCertainAndUniform() {
        assertEquals(1.0, Decision.confidenceOf(listOf(1.0, 0.0)))
        assertEquals(0.0, Decision.confidenceOf(listOf(0.5, 0.5)))
        assertEquals(1.0, Decision.confidenceOf(listOf(1.0)))
    }

    @Test
    fun argmaxKeepsTheFirstMaximum() {
        assertEquals(0, argmax(listOf(0.4, 0.4, 0.2)))
        assertEquals(2, argmax(listOf(0.1, 0.2, 0.7)))
    }

    @Test
    fun packSplitsOnQuestionsStatesAndImages() {
        fun item(key: String, images: Int) = PackItem(key, images, key)
        val byQuestion = pack(listOf(item("a", 0), item("a", 0), item("a", 0)), 2, 16, 0)
        assertEquals(listOf(listOf("a", "a"), listOf("a")), byQuestion.map { chunk -> chunk.map { it.payload } })

        val byState = pack(listOf(item("a", 0), item("b", 0)), 32, 1, 0)
        assertEquals(2, byState.size)

        val byImage = pack(listOf(item("a", 2), item("a", 2), item("b", 2)), 32, 16, 3)
        assertEquals(listOf(listOf("a", "a"), listOf("b")), byImage.map { chunk -> chunk.map { it.payload } })
    }

    @Test
    fun groupByStateKeepsFirstSeenOrder() {
        val items = listOf(
            PackItem("b", 0, "b1"),
            PackItem("a", 0, "a1"),
            PackItem("b", 0, "b2"),
        )
        assertEquals(listOf("b1", "b2", "a1"), groupByState(items).map { it.payload })
    }

    @Test
    fun errorCodesMatchTheTypeScriptSet() {
        assertEquals(
            listOf(
                "INVALID_QUESTION",
                "CHAIN_STARTED",
                "BACKEND_FAILED",
                "BACKEND_UNAVAILABLE",
                "UNSUPPORTED_INPUT",
                "BAD_RESPONSE",
            ),
            ErrorCode.entries.map { it.name },
        )
        assertTrue(ErrorCode.UNSUPPORTED_INPUT.name.isNotEmpty())
    }
}
