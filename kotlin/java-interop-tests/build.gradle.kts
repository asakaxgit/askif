plugins {
    java
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    testImplementation(project(":askif"))
    testImplementation(libs.junit.jupiter)
    // Gradle's worker launcher is older than JUnit 5.12. Put the matching launcher on the test classpath.
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.12.2")
}

tasks.test {
    useJUnitPlatform()
}
