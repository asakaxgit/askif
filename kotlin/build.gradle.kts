// PLACEHOLDER group: not a registered Maven coordinate. Replace before any publish.
// See spec/adr/0005-build-and-naming.md. This slice does not apply maven-publish.
group = "io.github.asakaxgit"
version = "0.1.0-SNAPSHOT"

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.dokka) apply false
    alias(libs.plugins.bcv) apply false
}

subprojects {
    group = rootProject.group
    version = rootProject.version
}
