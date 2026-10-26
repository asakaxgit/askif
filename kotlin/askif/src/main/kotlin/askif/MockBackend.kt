package askif

/** Answers one question for [MockBackend]. */
public fun interface Responder {
    /** Produce a result. Throw to fail the whole call. */
    public fun answer(state: State, question: Question): QuestionResult
}

/**
 * Test backend. `decideMany` asks [Responder] once per item when [hasDecideMany] is true.
 */
public class MockBackend private constructor(
    private val responder: Responder,
    override val multiState: Boolean,
    override val hasDecideMany: Boolean,
    override val limits: BackendLimits,
) : Backend {
    override val name: String = "mock"

    override suspend fun decide(state: State, questions: Map<String, Question>): Map<String, QuestionResult> {
        val results = linkedMapOf<String, QuestionResult>()
        for ((id, question) in questions) {
            results[id] = responder.answer(state, question)
        }
        return results
    }

    override suspend fun decideMany(items: List<DecisionItem>): List<ItemResult> =
        items.map { item ->
            when (val result = responder.answer(item.state, item.question)) {
                is QuestionResult.Answered -> ItemResult.answered(item.id, result.answer)
                is QuestionResult.Failed -> ItemResult.failed(item.id, result.error)
            }
        }

    public companion object {
        /** A single-state mock with no caps. */
        @JvmStatic
        public fun create(responder: Responder): MockBackend = MockBackend(responder, false, false, BackendLimits.NONE)

        /** A mock with explicit batching flags and caps. */
        @JvmStatic
        public fun create(
            responder: Responder,
            multiState: Boolean,
            hasDecideMany: Boolean,
            limits: BackendLimits,
        ): MockBackend = MockBackend(responder, multiState, hasDecideMany, limits)
    }
}
