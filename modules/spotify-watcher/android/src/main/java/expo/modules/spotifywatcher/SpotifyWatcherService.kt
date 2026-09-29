package expo.modules.spotifywatcher

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONObject
import java.io.File

/**
 * Bewaart de Spotify-broadcasts als JSON-regels in een bestand. De app leest en leegt het bestand
 * (readAndClear) en maakt er zelf "plays" van.
 */
object EventStore {
  private const val FILE = "spotify-events.jsonl"
  private const val PREFS = "spotify-watcher"
  private val lock = Any()

  fun handle(context: Context, intent: Intent) {
    val now = System.currentTimeMillis()
    val sent = intent.getLongExtra("timeSent", 0L)
    val t = if (sent > 0L && Math.abs(now - sent) < 60_000L) sent else now
    val json = JSONObject()
    json.put("t", t)
    when (intent.action) {
      META -> {
        val uri = intent.getStringExtra("id") ?: return
        json.put("type", "meta")
        json.put("id", uri.substringAfterLast(':'))
        json.put("name", intent.getStringExtra("track") ?: "")
        json.put("artist", intent.getStringExtra("artist") ?: "")
        // Spotify documenteert seconden, maar stuurt in de praktijk vaak milliseconden.
        val raw = (intent.extras?.get("length") as? Number)?.toLong() ?: 0L
        json.put("length", if (raw in 1..9_999) raw * 1000 else raw)
      }
      STATE -> {
        json.put("type", "state")
        json.put("playing", intent.getBooleanExtra("playing", false))
        val pos = (intent.extras?.get("playbackPosition") as? Number)?.toLong() ?: 0L
        json.put("pos", pos)
      }
      else -> return
    }
    append(context, json.toString())
  }

  private fun append(context: Context, line: String) {
    synchronized(lock) {
      val f = File(context.filesDir, FILE)
      // Vangnet: nooit groter dan ~4 MB als de app lang niet geopend wordt.
      if (f.exists() && f.length() > 4_000_000L) f.writeText("")
      f.appendText(line + "\n")
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("last", System.currentTimeMillis()).apply()
    }
  }

  fun readAndClear(context: Context): String {
    synchronized(lock) {
      val f = File(context.filesDir, FILE)
      if (!f.exists()) return ""
      val text = f.readText()
      f.writeText("")
      return text
    }
  }

  fun lastEventAt(context: Context): Long =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("last", 0L)

  const val META = "com.spotify.music.metadatachanged"
  const val STATE = "com.spotify.music.playbackstatechanged"
}

/** Voorgronddienst: houdt de ontvanger van de Spotify-broadcasts in leven, ook met het scherm uit. */
class SpotifyWatcherService : Service() {
  private var receiver: BroadcastReceiver? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        EventStore.handle(context, intent)
        // Live DJ: bij een nieuw nummer meteen het volgende klaarzetten (ook met je scherm uit).
        if (intent.action == EventStore.META) {
          val uri = intent.getStringExtra("id")
          if (uri != null && LiveQueuer.isActive(context)) {
            LiveQueuer.onBroadcast(context, uri.substringAfterLast(':'), intent.getStringExtra("artist") ?: "")
          }
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(EventStore.META)
      addAction(EventStore.STATE)
    }
    if (Build.VERSION.SDK_INT >= 33) {
      registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(r, filter)
    }
    receiver = r
    running = true
    LiveQueuer.resumeIfActive(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onDestroy() {
    receiver?.let {
      try {
        unregisterReceiver(it)
      } catch (_: Exception) {
      }
    }
    receiver = null
    running = false
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(CHANNEL_ID, "Meeluisteren", NotificationManager.IMPORTANCE_MIN)
      channel.description = "Freaking DJ luistert mee met Spotify om van je skips te leren."
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder
      .setContentTitle("Freaking DJ luistert mee")
      .setContentText("Leert van je skips in Spotify")
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .setContentIntent(pending)
      .build()
  }

  companion object {
    const val CHANNEL_ID = "freaking-dj-watcher"
    const val NOTIFICATION_ID = 4711

    @Volatile
    var running = false
  }
}
