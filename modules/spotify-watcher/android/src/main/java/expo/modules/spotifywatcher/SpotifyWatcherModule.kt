package expo.modules.spotifywatcher

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.speech.RecognizerIntent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * - Meeluisteren: start/stopt de voorgronddienst en geeft de opgevangen Spotify-gebeurtenissen door.
 * - Spraak: opent de spraakherkenning van Android (Nederlands) en geeft de tekst terug.
 */
class SpotifyWatcherModule : Module() {
  private var speechPromise: Promise? = null

  private val ctx: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Geen app-context")

  override fun definition() = ModuleDefinition {
    Name("SpotifyWatcher")

    Function("isRunning") { SpotifyWatcherService.running }

    Function("lastEventAt") { EventStore.lastEventAt(ctx).toDouble() }

    AsyncFunction("start") {
      val intent = Intent(ctx, SpotifyWatcherService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
      true
    }

    AsyncFunction("stop") {
      ctx.stopService(Intent(ctx, SpotifyWatcherService::class.java))
      true
    }

    AsyncFunction("readAndClear") { EventStore.readAndClear(ctx) }

    // ---------- Spotify-token (native is eigenaar, zodat de achtergrond ook kan vernieuwen) ----------

    AsyncFunction("authSet") { clientId: String, refresh: String, access: String, expiresAt: Double ->
      SpotifyAuth.set(ctx, clientId, refresh, access, expiresAt.toLong())
      true
    }

    AsyncFunction("authClear") {
      SpotifyAuth.clear(ctx)
      true
    }

    Function("hasAuth") { SpotifyAuth.hasAuth(ctx) }

    AsyncFunction("accessToken") { force: Boolean -> SpotifyAuth.accessToken(ctx, force) }

    // ---------- Live DJ in de dienst ----------

    AsyncFunction("liveStart") { queuedId: String, candidatesJson: String ->
      // De dienst moet draaien om de Spotify-broadcasts op te vangen.
      val intent = Intent(ctx, SpotifyWatcherService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
      LiveQueuer.start(ctx, queuedId, candidatesJson)
      true
    }

    AsyncFunction("liveSetCandidates") { candidatesJson: String ->
      LiveQueuer.setCandidates(ctx, candidatesJson)
      true
    }

    AsyncFunction("liveSetQueued") { id: String, metaJson: String ->
      LiveQueuer.setQueued(ctx, id, metaJson)
      true
    }

    AsyncFunction("liveStop") {
      LiveQueuer.stop(ctx)
      true
    }

    AsyncFunction("liveState") { LiveQueuer.state(ctx) }

    // hints: jouw vibes en artiesten; op Android 13+ stuurt de herkenner daarop bij.
    // Geeft tot 5 alternatieven terug (beste eerst); JS kiest en verbetert.
    AsyncFunction("listen") { prompt: String, hints: List<String>, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("E_NO_ACTIVITY", "De app staat niet op de voorgrond", null)
        return@AsyncFunction
      }
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "nl-NL")
        putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
        if (Build.VERSION.SDK_INT >= 33 && hints.isNotEmpty()) {
          putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(hints))
        }
      }
      speechPromise?.resolve(emptyList<String>())
      speechPromise = promise
      try {
        activity.startActivityForResult(intent, SPEECH_REQUEST)
      } catch (e: ActivityNotFoundException) {
        speechPromise = null
        promise.reject("E_NO_SPEECH", "Spraakherkenning is niet beschikbaar op dit toestel", e)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != SPEECH_REQUEST) return@OnActivityResult
      val p = speechPromise ?: return@OnActivityResult
      speechPromise = null
      val results: List<String> = if (payload.resultCode == Activity.RESULT_OK) {
        payload.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.toList() ?: emptyList()
      } else {
        emptyList()
      }
      p.resolve(results)
    }

    /** Opent de accu-instellingen, zodat je de app "Onbeperkt" kunt geven (Samsung stopt anders de dienst). */
    AsyncFunction("openBatterySettings") {
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      val detail = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))
      activity.startActivity(detail)
      true
    }

    /** Opent de Spotify-app (om "Apparaatuitzending" aan te zetten). */
    AsyncFunction("openSpotify") {
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      val launch = ctx.packageManager.getLaunchIntentForPackage("com.spotify.music") ?: return@AsyncFunction false
      activity.startActivity(launch)
      true
    }
  }

  companion object {
    const val SPEECH_REQUEST = 7301
  }
}
