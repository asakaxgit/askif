package askif

import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred

class AskTest {
    @Test
    fun cancellingOneHandleLeavesTheBatchMateAndTheDecideCall() {
        val release = CompletableDeferred<Unit>()
        val calls = AtomicInteger()
        val backend = object : Backend {
            override val name: String = "hold"
            override suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult> {
                calls.incrementAndGet()
                release.await()
                return questions.mapValues { QuestionResult.answered(YesNoAnswer(0.9)) }
            }
        }
        val ask = Ask.create(backend)
        val handles = mutableListOf<Handle<Boolean>>()
        ask.batch {
            handles += askIsHandle(States.of("a"), "one")
            handles += askIsHandle(States.of("a"), "two")
        }
        handles[0].cancel()
        release.complete(Unit)
        assertFailsWith<kotlinx.coroutines.CancellationException> { handles[0].awaitBlocking() }
        assertTrue(handles[1].awaitBlocking())
        assertEquals(1, calls.get())
    }

    @Test
    fun configureDuringDecideIsVisibleAtJudgement() {
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val backend = object : Backend {
            override val name: String = "hold"
            override suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult> {
                entered.complete(Unit)
                release.await()
                return mapOf("q0" to QuestionResult.answered(YesNoAnswer(0.6)))
            }
        }
        val ask = Ask.create(backend)
        val future: CompletableFuture<Boolean> = ask.askIsAsync(States.of("x"), "y")
        while (!entered.isCompleted) Thread.sleep(5)
        ask.configure(ConfigPatch().threshold(0.7))
        release.complete(Unit)
        assertFalse(future.get())
    }

    @Test
    fun blockingReentryThrows() {
        val ask = Ask.create(fixedYes(0.9))
        val error = assertFailsWith<IllegalStateException> {
            ask.askIf(States.of("x"), "y")
                .then(Handler { ask.askIsBlocking(States.of("x"), "z") })
                .orElse(Handler { })
                .runBlocking()
        }
        assertTrue(error.message?.contains("askif-blocking") == true)
    }

    @Test
    fun sameStateBatchIsOneDecide() {
        val calls = AtomicInteger()
        val backend = object : Backend {
            override val name: String = "count"
            override suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult> {
                calls.incrementAndGet()
                assertEquals(2, questions.size)
                return questions.mapValues { QuestionResult.answered(YesNoAnswer(0.1)) }
            }
        }
        val ask = Ask.create(backend)
        val dog = States.of("dog")
        val handles = ask.batch(dog) {
            listOf(askIs("is animal"), askIs("is a vehicle"))
        }
        assertFalse(handles[0].awaitBlocking())
        assertFalse(handles[1].awaitBlocking())
        assertEquals(1, calls.get())
    }
}

private fun fixedYes(probability: Double): Backend = object : Backend {
    override val name: String = "fixed"
    override suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult> =
        questions.mapValues { QuestionResult.answered(YesNoAnswer(probability)) }
}
