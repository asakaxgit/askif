package askif;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import kotlinx.serialization.json.JsonElement;
import org.junit.jupiter.api.Test;

class JavaInteropTest {
    @Test
    void askIsBlockingAndProbabilityAsync() throws Exception {
        Ask ask = Ask.create(new YesBackend(0.6));
        assertTrue(ask.askIs(States.of("cat"), "is animal"));
        double probability = ask.probabilityAsync(States.of("cat"), "is animal").get(5, TimeUnit.SECONDS);
        assertEquals(0.6, probability);
        ask.configure(new ConfigPatch().threshold(0.7));
        assertFalse(ask.askIs(States.of("cat"), "is animal"));
    }

    @Test
    void askIfRunAndRunAsync() throws Exception {
        Ask ask = Ask.create(new YesBackend(0.2));
        List<String> ran = new ArrayList<>();
        IfResult low = ask.askIf(States.of("cat"), "is cute")
            .then(result -> ran.add("then"))
            .orElse(result -> ran.add("else"))
            .unsure(result -> ran.add("unsure"), UnsureMode.STOP)
            .run();
        assertEquals(Branch.UNSURE, low.getBranch());
        assertEquals(List.of("unsure"), ran);

        ran.clear();
        IfResult viaFuture = ask.askIf(States.of("cat"), "is cute")
            .orElse(result -> ran.add("else"))
            .runAsync()
            .get(5, TimeUnit.SECONDS);
        assertEquals(Branch.ELSE, viaFuture.getBranch());
        assertEquals(List.of("else"), ran);
    }

    @Test
    void askSwitchAndScore() throws Exception {
        Ask ask = Ask.create(new MixedBackend());
        List<String> ran = new ArrayList<>();
        SwitchResult switched = ask.askSwitch(States.of("hi"), States.of("tone?"))
            .option("calm")
            .option("angry", States.of("mad"))
            .other()
            .unsure(result -> ran.add("unsure"))
            .run();
        assertEquals(Branch.CASE, switched.getBranch());
        assertEquals("calm", switched.getChoice());
        assertEquals(List.of(), ran);

        ScoreResult scored = ask.score(States.of("hi"), States.of("how?"))
            .level("low")
            .level("high", result -> ran.add("level"))
            .run();
        assertEquals(Branch.LEVEL, scored.getBranch());
        assertEquals("high", scored.getLevel());
        assertEquals(1, scored.getIndex());
        assertEquals(List.of("level"), ran);
    }

    @Test
    void backendOverrideAndBatchAreOneDecide() {
        AtomicInteger mainCalls = new AtomicInteger();
        AtomicInteger otherCalls = new AtomicInteger();
        YesBackend main = new YesBackend(0.9, mainCalls);
        YesBackend other = new YesBackend(0.1, otherCalls);
        Ask ask = Ask.create(main);
        assertFalse(ask.askIs(States.of("x"), "y", new IfOptions().backend(other)));
        assertEquals(0, mainCalls.get());
        assertEquals(1, otherCalls.get());

        Batch batch = ask.openBatch();
        Handle<Boolean> first = ask.askIsHandle(States.of("dog"), "is animal");
        Handle<Boolean> second = ask.askIsHandle(States.of("dog"), "is good");
        batch.submit();
        assertTrue(first.await());
        assertTrue(second.await());
        assertEquals(1, mainCalls.get());
    }

    @Test
    void invalidQuestionBackendFailedAndBadResponse() {
        Ask ask = Ask.create(new YesBackend(0.9));
        AskException invalid = assertThrows(AskException.class, () ->
            ask.askSwitch(States.of("x"), States.of("q")).option("only").run());
        assertEquals(ErrorCode.INVALID_QUESTION, invalid.getCode());

        Ask failed = Ask.create(new FailingBackend());
        AskException backend = assertThrows(AskException.class, () -> failed.askIs(States.of("x"), "y"));
        assertEquals(ErrorCode.BACKEND_FAILED, backend.getCode());

        Ask bad = Ask.create(new WrongKindBackend());
        AskException response = assertThrows(AskException.class, () -> bad.askIs(States.of("x"), "y"));
        assertEquals(ErrorCode.BAD_RESPONSE, response.getCode());
    }

    @Test
    void customJavaBackend() {
        AtomicInteger calls = new AtomicInteger();
        JavaBackend backend = new JavaBackend("scripted") {
            @Override
            public CompletableFuture<Map<String, QuestionResult>> decideAsync(JsonElement state, Map<String, Question> questions) {
                calls.incrementAndGet();
                Map<String, QuestionResult> out = new LinkedHashMap<>();
                for (Map.Entry<String, Question> entry : questions.entrySet()) {
                    Question question = entry.getValue();
                    assertInstanceOf(YesNoQuestion.class, question);
                    out.put(entry.getKey(), QuestionResult.answered(new YesNoAnswer(0.95)));
                }
                return CompletableFuture.completedFuture(out);
            }
        };
        Ask ask = Ask.create(backend);
        assertTrue(ask.askIs(States.of("x"), "y"));
        assertEquals(1, calls.get());
    }

    private static final class YesBackend extends JavaBackend {
        private final double probability;
        private final AtomicInteger calls;

        YesBackend(double probability) {
            this(probability, new AtomicInteger());
        }

        YesBackend(double probability, AtomicInteger calls) {
            super("yes");
            this.probability = probability;
            this.calls = calls;
        }

        @Override
        public CompletableFuture<Map<String, QuestionResult>> decideAsync(JsonElement state, Map<String, Question> questions) {
            calls.incrementAndGet();
            Map<String, QuestionResult> out = new LinkedHashMap<>();
            for (String id : questions.keySet()) {
                out.put(id, QuestionResult.answered(new YesNoAnswer(probability)));
            }
            return CompletableFuture.completedFuture(out);
        }
    }

    private static final class MixedBackend extends JavaBackend {
        MixedBackend() {
            super("mixed");
        }

        @Override
        public CompletableFuture<Map<String, QuestionResult>> decideAsync(JsonElement state, Map<String, Question> questions) {
            Map<String, QuestionResult> out = new LinkedHashMap<>();
            for (Map.Entry<String, Question> entry : questions.entrySet()) {
                Question question = entry.getValue();
                if (question instanceof ChoiceQuestion) {
                    Map<String, Double> probabilities = new LinkedHashMap<>();
                    probabilities.put("calm", 0.8);
                    probabilities.put("angry", 0.1);
                    probabilities.put("other", 0.1);
                    out.put(entry.getKey(), QuestionResult.answered(new ChoiceAnswer(probabilities, 0.9)));
                } else if (question instanceof ScaleQuestion) {
                    out.put(entry.getKey(), QuestionResult.answered(new ScaleAnswer(List.of(0.2, 0.8), 0.9)));
                } else {
                    out.put(entry.getKey(), QuestionResult.answered(new YesNoAnswer(0.9)));
                }
            }
            return CompletableFuture.completedFuture(out);
        }
    }

    private static final class FailingBackend extends JavaBackend {
        FailingBackend() {
            super("down");
        }

        @Override
        public CompletableFuture<Map<String, QuestionResult>> decideAsync(JsonElement state, Map<String, Question> questions) {
            return CompletableFuture.failedFuture(new IllegalStateException("down"));
        }
    }

    private static final class WrongKindBackend extends JavaBackend {
        WrongKindBackend() {
            super("wrong");
        }

        @Override
        public CompletableFuture<Map<String, QuestionResult>> decideAsync(JsonElement state, Map<String, Question> questions) {
            Map<String, QuestionResult> out = new LinkedHashMap<>();
            for (String id : questions.keySet()) {
                out.put(id, QuestionResult.answered(new ChoiceAnswer(Map.of("a", 1.0))));
            }
            return CompletableFuture.completedFuture(out);
        }
    }
}
