package askif

/** Why an askif call failed. Stable names; JVM 0.1 does not throw every code. */
public enum class ErrorCode {
    /** Too few or too many options or levels, or a duplicate key. */
    INVALID_QUESTION,

    /** A chain method ran after the question was sent. */
    CHAIN_STARTED,

    /** The backend call failed. The original throwable is the cause. */
    BACKEND_FAILED,

    /** Reserved for adapters that cannot load. Nothing in 0.1 throws this. */
    BACKEND_UNAVAILABLE,

    /** Reserved for inputs the backend cannot take. Nothing in 0.1 throws this. */
    UNSUPPORTED_INPUT,

    /** The answer was missing or did not match the question. */
    BAD_RESPONSE,
}

/** Unchecked failure carrying an [ErrorCode]. */
public class AskException public constructor(
    /** Machine-readable reason. */
    public val code: ErrorCode,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)
