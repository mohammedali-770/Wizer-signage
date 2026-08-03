package com.wizer.signage.system

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Last line of defence for an unattended wall-mounted screen.
 *
 * Without a default uncaught-exception handler, any crash on any thread leaves
 * the TV sitting on the launcher (or a dead black frame) until somebody drives
 * to the site and power-cycles it — a truck roll per crash. This persists the
 * trace for the next heartbeat, asks the system to start the player again, and
 * only then lets the process die.
 *
 * The pure helpers ([formatReport]) are Android-free so they stay covered by the
 * project's plain-JUnit suite.
 */
object CrashRecovery {

    /**
     * Delay before the relaunch alarm fires. Kept short deliberately: the
     * platform grants a recently-foreground uid a brief window in which a
     * background activity start is still allowed, and a longer wait would also
     * mean a longer dead screen.
     */
    const val RELAUNCH_DELAY_MS = 5_000L

    /** Bounds the persisted report — a StackOverflowError trace is enormous. */
    const val MAX_REPORT_CHARS = 32_000

    /** Written under filesDir; read + cleared by [consumeLastCrash]. */
    const val CRASH_FILE_NAME = "last-crash.txt"

    private const val RELAUNCH_REQUEST_CODE = 0x5163

    /** Install once, from Application.onCreate. Re-installing is a no-op. */
    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        if (previous is RelaunchingHandler) return
        Thread.setDefaultUncaughtExceptionHandler(RelaunchingHandler(app, previous))
    }

    /**
     * The persisted trace from the previous run, removed as it is read so it is
     * reported at most once. Null when the last run exited cleanly.
     */
    fun consumeLastCrash(context: Context): String? = try {
        val file = File(context.applicationContext.filesDir, CRASH_FILE_NAME)
        if (!file.isFile) null else file.readText().also { file.delete() }
    } catch (t: Throwable) {
        null
    }

    /** Stack trace plus the little context worth keeping, length-bounded. */
    fun formatReport(throwable: Throwable, threadName: String, atMillis: Long): String {
        val header = "at=$atMillis thread=$threadName\n"
        val trace = StringWriter().also { sw -> PrintWriter(sw).use { throwable.printStackTrace(it) } }.toString()
        val room = (MAX_REPORT_CHARS - header.length).coerceAtLeast(0)
        return header + if (trace.length <= room) trace else trace.substring(0, room)
    }

    private class RelaunchingHandler(
        private val app: Context,
        private val previous: Thread.UncaughtExceptionHandler?,
    ) : Thread.UncaughtExceptionHandler {

        override fun uncaughtException(thread: Thread, error: Throwable) {
            // Every step is guarded on its own: throwing in here (full disk, OOM,
            // a missing AlarmManager on an odd OEM build) would abort the handler
            // and leave the screen dead — exactly what this exists to prevent.
            try {
                persist(formatReport(error, thread.name, System.currentTimeMillis()))
            } catch (t: Throwable) {
                // Nothing left to do; the relaunch matters more than the report.
            }
            try {
                scheduleRelaunch(app)
            } catch (t: Throwable) {
                // Best-effort: the boot receiver still covers a power cycle.
            }
            try {
                // Keep the platform's logcat crash dump for on-site debugging.
                previous?.uncaughtException(thread, error)
            } catch (t: Throwable) {
                // Ignore — we kill the process below regardless.
            }
            // The delegate normally kills us; make sure a half-dead process can
            // never linger showing a frozen frame that the alarm cannot replace.
            Process.killProcess(Process.myPid())
        }

        private fun persist(report: String) {
            File(app.filesDir, CRASH_FILE_NAME).writeText(report)
        }

        private fun scheduleRelaunch(context: Context) {
            val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(context, BootLaunch.TARGET_ACTIVITY).apply { flags = BootLaunch.LAUNCH_FLAGS }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
            val pending = PendingIntent.getActivity(context, RELAUNCH_REQUEST_CODE, intent, flags)
            val at = System.currentTimeMillis() + RELAUNCH_DELAY_MS
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    // AllowWhileIdle so a screen that crashed overnight, with the box
                    // already dozing, still comes back before opening hours.
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
                } else {
                    alarms.setExact(AlarmManager.RTC_WAKEUP, at, pending)
                }
            } catch (e: SecurityException) {
                // Android 12+ may withhold exact-alarm permission; an inexact alarm
                // still brings the screen back, just a little later.
                alarms.set(AlarmManager.RTC_WAKEUP, at, pending)
            }
        }
    }
}
