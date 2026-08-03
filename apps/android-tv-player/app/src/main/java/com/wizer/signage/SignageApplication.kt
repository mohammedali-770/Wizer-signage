package com.wizer.signage

import android.app.Application
import com.wizer.signage.system.CrashRecovery

/**
 * Process entry point. Exists solely so the crash handler is installed before
 * any player code can run — the Activity is too late, since a crash during its
 * own creation would go unhandled.
 */
class SignageApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        CrashRecovery.install(this)
    }
}
