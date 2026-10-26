import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.bcv)
    alias(libs.plugins.dokka)
}

kotlin {
    // Compile with JDK 21. Bytecode and the published JVM attribute stay 17 (ADR 0003).
    jvmToolchain(21)
    explicitApi()
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        languageVersion.set(KotlinVersion.KOTLIN_2_0)
        apiVersion.set(KotlinVersion.KOTLIN_2_0)
        freeCompilerArgs.add("-Xjvm-default=all")
    }
}

// jvmToolchain(21) otherwise advertises the library as JVM 21, which JDK 17 consumers cannot resolve.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    implementation(libs.coroutines.core)
    // State is JsonElement, so Java callers compile against this artifact.
    api(libs.serialization.json)
    testImplementation(kotlin("test-junit5"))
}

tasks.test {
    useJUnitPlatform()
}
