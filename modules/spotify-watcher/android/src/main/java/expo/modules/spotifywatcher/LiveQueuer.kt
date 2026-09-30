package expo.modules.spotifywatcher

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * Spotify-token, beheerd in native code zodat de achtergrond (met je scherm uit) ook kan vernieuwen.
 * Eén eigenaar voorkomt dat app en dienst elkaars roterende refresh-token ongeldig maken.
 */
object SpotifyAuth {
  private const val PREFS = "fdj-auth"
  private val lock = Any()

  fun set(ctx: Context, clientId: String, refresh: String, access: String, expiresAt: Long) {
    synchronized(lock) {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("clientId", clientId)
        .putString("refresh", refresh)
        .putString("access", access)
        .putLong("expiresAt", expiresAt)
        .apply()
    }
  }

  fun clear(ctx: Context) {
    synchronized(lock) { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply() }
  }

  fun hasAuth(ctx: Context): Boolean =
    !ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("refresh", null).isNullOrEmpty()

  /** Geldig access-token (vernieuwt zo nodig). Blokkeert: niet op de main thread aanroepen. */
  fun accessToken(ctx: Context, force: Boolean = false): String {
    synchronized(lock) {
      val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val access = p.getString("access", null)
      val expiresAt = p.getLong("expiresAt", 0L)
      if (!force && !access.isNullOrEmpty() && expiresAt > System.currentTimeMillis() + 60_000L) return access
      val refresh = p.getString("refresh", null) ?: throw IllegalStateException("Spotify is niet gekoppeld")
      val clientId = p.getString("clientId", null) ?: throw IllegalStateException("Spotify is niet gekoppeld")
      val body = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refresh, "UTF-8") +
        "&client_id=" + URLEncoder.encode(clientId, "UTF-8")
      val conn = URL("https://accounts.spotify.com/api/token").openConnection() as HttpURLConnection
      try {
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        conn.outputStream.use { it.write(body.toByteArray()) }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) {
          if (text.contains("invalid_grant")) clear(ctx)
          throw IllegalStateException("Spotify-token vernieuwen mislukt ($code)")
        }
        val json = JSONObject(text)
        val newAccess = json.getString("access_token")
        val expiresIn = json.optLong("expires_in", 3600L)
        val edit = p.edit()
          .putString("access", newAccess)
          .putLong("expiresAt", System.currentTimeMillis() + expiresIn * 1000L)
        val newRefresh = json.optString("refresh_token", "")
        if (newRefresh.isNotEmpty()) edit.putString("refresh", newRefresh)
        edit.apply()
        return newAccess
      } finally {
        conn.disconnect()
      }
    }
  }

  /** Eenvoudige Web API-aanroep. Geeft (statuscode, body). Vernieuwt het token één keer bij 401. */
  fun call(ctx: Context, method: String, path: String): Pair<Int, String> {
    for (attempt in 0..1) {
      val token = accessToken(ctx, force = attempt == 1)
      val conn = URL("https://api.spotify.com/v1$path").openConnection() as HttpURLConnection
      try {
        conn.requestMethod = method
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.setRequestProperty("Authorization", "Bearer $token")
        if (method == "POST" || method == "PUT") {
          conn.doOutput = true
          conn.setRequestProperty("Content-Length", "0")
          conn.outputStream.use { }
        }
        val code = conn.responseCode
        if (code == 401 && attempt == 0) continue
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = if (code == 204) "" else stream?.bufferedReader()?.use { it.readText() } ?: ""
        return Pair(code, text)
      } finally {
        conn.disconnect()
      }
    }
    return Pair(401, "")
  }
}

/**
 * Live DJ in de dienst: zodra ons klaargezette nummer begint, zet hij meteen het volgende in de
 * Spotify-wachtrij. Werkt ook met je scherm uit. Twee triggers:
 *  - de Spotify-broadcast "nummer gewisseld" (direct, als Spotify op deze telefoon speelt);
 *  - zelf de speler bekijken, vlak voor het eind van elk nummer (ook als je op je pc of de Denon speelt).
 * De app levert de kandidaten (al gecontroleerd op je regels) en haalt op wat de dienst deed.
 * Keuze-regels komen overeen met pickNext in src/logic/live.ts (vereenvoudigd).
 */
object LiveQueuer {
  private const val TAG = "FreakingDJ"
  private const val PREFS = "fdj-live"
  private const val QUICK_SKIP_MS = 30_000L
  private const val IDLE_STOP_MS = 30 * 60 * 1000L
  private const val SERVED_MAX = 500
  private val lock = Any()
  private val executor = Executors.newSingleThreadExecutor()
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var appContext: Context? = null
  private var idleSince = 0L

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isActive(ctx: Context) = prefs(ctx).getBoolean("active", false)

  fun start(ctx: Context, queuedId: String, candidatesJson: String) {
    synchronized(lock) {
      prefs(ctx).edit()
        .putBoolean("active", true)
        .putString("queuedId", queuedId)
        .putString("candidates", candidatesJson)
        .putString("history", "[]")
        .putString("queuedMeta", "{}")
        .putString("error", "")
        .putString("lastId", "")
        .putLong("lastAt", 0L)
        .putString("lastMeta", "{}")
        .putString("served", JSONArray().put(queuedId).toString())
        .putString("servedKeys", "[]")
        .apply()
    }
    ensureLoop(ctx)
  }

  // ---------- sessiegeheugen: alles wat in deze sessie klaargezet is of speelde ----------

  private fun readSet(p: SharedPreferences, name: String): MutableSet<String> {
    val out = LinkedHashSet<String>()
    try {
      val a = JSONArray(p.getString(name, "[]") ?: "[]")
      for (i in 0 until a.length()) {
        val v = a.optString(i)
        if (v.isNotEmpty()) out.add(v)
      }
    } catch (_: Exception) {
    }
    return out
  }

  private fun trimSet(set: MutableSet<String>) {
    while (set.size > SERVED_MAX) {
      val iter = set.iterator()
      iter.next()
      iter.remove()
    }
  }

  private fun writeServed(edit: SharedPreferences.Editor, ids: MutableSet<String>, keys: MutableSet<String>) {
    trimSet(ids)
    trimSet(keys)
    edit.putString("served", JSONArray(ids).toString()).putString("servedKeys", JSONArray(keys).toString())
  }

  fun setCandidates(ctx: Context, candidatesJson: String) {
    synchronized(lock) {
      val p = prefs(ctx)
      // De app loopt soms achter op wat de dienst net deed (bv. na bijsturen door Claude): zet nooit
      // iets terug in de lijst dat al klaarstaat, speelt of gespeeld is.
      val used = HashSet<String>()
      val queued = p.getString("queuedId", "") ?: ""
      val last = p.getString("lastId", "") ?: ""
      if (queued.isNotEmpty()) used.add(queued)
      if (last.isNotEmpty()) used.add(last)
      val history = JSONArray(p.getString("history", "[]") ?: "[]")
      for (i in 0 until history.length()) used.add(history.getJSONObject(i).optString("id"))
      // Ook alles wat de dienst ooit klaarzette of zag spelen, ook zonder geschiedenis (scherm uit, geen Apparaatuitzending).
      used.addAll(readSet(p, "served"))
      val usedKeys = readSet(p, "servedKeys")
      val incoming = JSONArray(candidatesJson)
      val kept = JSONArray()
      for (i in 0 until incoming.length()) {
        val c = incoming.getJSONObject(i)
        val key = c.optString("key")
        if (c.optString("id") !in used && (key.isEmpty() || key !in usedKeys)) kept.put(c)
      }
      p.edit().putString("candidates", kept.toString()).apply()
    }
  }

  /** De app heeft zelf een nummer klaargezet (vangnet): dat is nu het nummer om op te wachten. */
  fun setQueued(ctx: Context, id: String, metaJson: String) {
    synchronized(lock) {
      val p = prefs(ctx)
      val ids = readSet(p, "served")
      val keys = readSet(p, "servedKeys")
      if (id.isNotEmpty()) ids.add(id)
      try {
        val key = JSONObject(metaJson).optString("key")
        if (key.isNotEmpty()) keys.add(key)
      } catch (_: Exception) {
      }
      val edit = p.edit().putString("queuedId", id).putString("queuedMeta", metaJson)
      writeServed(edit, ids, keys)
      edit.apply()
    }
  }

  fun stop(ctx: Context) {
    synchronized(lock) { prefs(ctx).edit().putBoolean("active", false).apply() }
    handler?.removeCallbacksAndMessages(null)
    releaseWake()
  }

  /** Voor de app: {active, queuedId, history:[{id,outcome,listenedMs,at}], error}. */
  fun state(ctx: Context): String {
    synchronized(lock) {
      val p = prefs(ctx)
      val o = JSONObject()
      o.put("active", p.getBoolean("active", false))
      o.put("queuedId", p.getString("queuedId", "") ?: "")
      o.put("history", JSONArray(p.getString("history", "[]") ?: "[]"))
      o.put("served", JSONArray(p.getString("served", "[]") ?: "[]"))
      o.put("error", p.getString("error", "") ?: "")
      return o.toString()
    }
  }

  /** Broadcast van Spotify: er begint een nummer. */
  fun onBroadcast(ctx: Context, id: String, artist: String) {
    val app = ctx.applicationContext
    executor.execute {
      try {
        trackStarted(app, id, listOf(artist), fromBroadcast = true)
      } catch (e: Exception) {
        setError(app, e.message ?: e.toString())
      }
    }
  }

  // ---------- kern ----------

  private fun trackStarted(ctx: Context, id: String, artists: List<String>, fromBroadcast: Boolean) {
    val now = System.currentTimeMillis()
    var pick: JSONObject? = null
    synchronized(lock) {
      val p = prefs(ctx)
      if (!p.getBoolean("active", false)) return
      val lastId = p.getString("lastId", "") ?: ""
      val lastAt = p.getLong("lastAt", 0L)
      val edit = p.edit()
      val history = JSONArray(p.getString("history", "[]") ?: "[]")
      // Sessiegeheugen: wat nu speelt is geweest, ook als het geen nummer van ons is (autoplay) en ook zonder broadcast.
      val servedIds = readSet(p, "served")
      val servedKeys = readSet(p, "servedKeys")
      if (id.isNotEmpty()) servedIds.add(id)
      if (fromBroadcast && id != lastId) {
        // Het vorige nummer afsluiten, als dat van ons was: helemaal gehoord of geskipt.
        val lastMeta = JSONObject(p.getString("lastMeta", "{}") ?: "{}")
        if (lastId.isNotEmpty() && lastMeta.optString("id") == lastId) {
          val listened = now - lastAt
          val len = lastMeta.optLong("durationMs", 0L)
          val full = len > 0 && (listened >= len * 0.9 || len - listened <= 15_000L)
          val h = JSONObject()
          h.put("id", lastId)
          h.put("outcome", if (full) "full" else "skip")
          h.put("listenedMs", listened)
          h.put("at", now)
          h.put("meta", lastMeta)
          history.put(h)
          while (history.length() > 60) history.remove(0)
          edit.putString("history", history.toString())
        }
        edit.putString("lastId", id).putLong("lastAt", now)
      }
      val queuedId = p.getString("queuedId", "") ?: ""
      if (id != queuedId || queuedId.isEmpty()) {
        writeServed(edit, servedIds, servedKeys)
        edit.apply()
        return
      }
      // Ons nummer begint: dat wordt het "huidige"; kies het volgende.
      var currentMeta = JSONObject(p.getString("queuedMeta", "{}") ?: "{}")
      if (currentMeta.optString("id") != id) currentMeta = JSONObject().put("id", id).put("artists", JSONArray(artists))
      edit.putString("lastMeta", currentMeta.toString())
      val candidates = JSONArray(p.getString("candidates", "[]") ?: "[]")
      val currentKey = currentMeta.optString("key")
      if (currentKey.isNotEmpty()) servedKeys.add(currentKey)
      pick = choose(candidates, currentMeta, artists, history, servedIds, servedKeys)
      if (pick == null) {
        edit.putString("queuedId", "")
        writeServed(edit, servedIds, servedKeys)
        edit.apply()
        return
      }
      // Eerst vastleggen: nooit twee tegelijk in de wachtrij.
      val rest = JSONArray()
      for (i in 0 until candidates.length()) {
        val c = candidates.getJSONObject(i)
        if (c.optString("id") != pick!!.optString("id")) rest.put(c)
      }
      edit.putString("candidates", rest.toString())
      edit.putString("queuedId", pick!!.optString("id"))
      edit.putString("queuedMeta", pick.toString())
      // Direct onthouden, nog voor Spotify antwoordt: zo komt het nooit meer terug, ook niet via een nieuwe lijst van de app.
      servedIds.add(pick!!.optString("id"))
      val pickKey = pick!!.optString("key")
      if (pickKey.isNotEmpty()) servedKeys.add(pickKey)
      writeServed(edit, servedIds, servedKeys)
      edit.apply()
    }
    val next = pick ?: return
    val (code, text) = SpotifyAuth.call(ctx, "POST", "/me/player/queue?uri=" + URLEncoder.encode("spotify:track:" + next.optString("id"), "UTF-8"))
    if (code !in 200..299) {
      Log.w(TAG, "Wachtrij zetten mislukt: $code $text")
      synchronized(lock) {
        // Terugdraaien, zodat de app of de volgende controle het opnieuw probeert.
        val p = prefs(ctx)
        val candidates = JSONArray(p.getString("candidates", "[]") ?: "[]")
        val back = JSONArray().put(next)
        for (i in 0 until candidates.length()) back.put(candidates.getJSONObject(i))
        val why = if (text.contains("Restricted device", ignoreCase = true)) "Dit apparaat laat geen wachtrij toe (Restricted device)" else "Wachtrij zetten mislukt ($code)"
        // Het nummer is niet klaargezet: weer uit het sessiegeheugen, anders wordt het nooit meer gekozen.
        val ids = readSet(p, "served")
        val keys = readSet(p, "servedKeys")
        ids.remove(next.optString("id"))
        val nk = next.optString("key")
        if (nk.isNotEmpty()) keys.remove(nk)
        val edit = p.edit().putString("candidates", back.toString()).putString("queuedId", "").putString("error", why)
        writeServed(edit, ids, keys)
        edit.apply()
      }
    } else {
      setError(ctx, "")
    }
  }

  private fun names(a: JSONArray?): MutableSet<String> {
    val out = HashSet<String>()
    if (a == null) return out
    for (i in 0 until a.length()) out.add(a.optString(i).trim().lowercase())
    return out
  }

  /** Zelfde gedachte als pickNext: volgorde aanhouden, maar na skips bijsturen. */
  private fun choose(
    candidates: JSONArray,
    current: JSONObject,
    currentArtists: List<String>,
    history: JSONArray,
    servedIds: Set<String>,
    servedKeys: Set<String>,
  ): JSONObject? {
    if (candidates.length() == 0) return null
    val cur = names(current.optJSONArray("artists"))
    cur.addAll(currentArtists.map { it.trim().lowercase() })
    // Recente skips (achteraan de geschiedenis, tot het eerste helemaal gehoorde nummer).
    val skippedArtists = HashSet<String>()
    val skippedStyles = HashMap<String, Int>()
    var lastSkipWasNew = false
    var i = history.length() - 1
    var n = 0
    while (i >= 0 && n < 3) {
      val h = history.getJSONObject(i)
      if (h.optString("outcome") != "skip") break
      val meta = h.optJSONObject("meta")
      if (meta != null) {
        skippedArtists.addAll(names(meta.optJSONArray("artists")))
        val st = meta.optString("style").lowercase()
        skippedStyles[st] = (skippedStyles[st] ?: 0) + 1
        if (n == 0 && h.optLong("listenedMs") < QUICK_SKIP_MS) lastSkipWasNew = meta.optBoolean("isNew")
      }
      n++
      i--
    }
    var best: JSONObject? = null
    var bestScore = Int.MIN_VALUE
    for (k in 0 until candidates.length()) {
      val c = candidates.getJSONObject(k)
      // Al klaargezet of gespeeld in deze sessie (ook een andere versie via `key`): nooit opnieuw.
      val cid = c.optString("id")
      val ckey = c.optString("key")
      if (cid in servedIds || (ckey.isNotEmpty() && ckey in servedKeys)) continue
      val artists = names(c.optJSONArray("artists"))
      var score = -k
      if (artists.any { it in cur }) score -= 100
      if (artists.any { it in skippedArtists }) score -= 30
      if (lastSkipWasNew && c.optBoolean("isNew")) score -= 15
      val ss = skippedStyles[c.optString("style").lowercase()] ?: 0
      if (ss >= 2) score -= 25 else if (ss == 1) score -= 4
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
    return best
  }

  private fun setError(ctx: Context, msg: String) {
    synchronized(lock) { prefs(ctx).edit().putString("error", msg).apply() }
  }

  // ---------- zelf kijken (vangnet en voor je pc / de Denon) ----------

  private fun ensureLoop(ctx: Context) {
    appContext = ctx.applicationContext
    if (thread == null) {
      val t = HandlerThread("fdj-live")
      t.start()
      thread = t
      handler = Handler(t.looper)
    }
    acquireWake(ctx)
    idleSince = 0L
    handler?.removeCallbacksAndMessages(null)
    handler?.post { poll() }
  }

  private fun poll() {
    val ctx = appContext ?: return
    if (!isActive(ctx)) {
      releaseWake()
      return
    }
    var delay = 15_000L
    try {
      val (code, text) = SpotifyAuth.call(ctx, "GET", "/me/player")
      val now = System.currentTimeMillis()
      if (code == 200 && text.isNotEmpty()) {
        val o = JSONObject(text)
        val item = o.optJSONObject("item")
        val playing = o.optBoolean("is_playing", false)
        if (item != null && playing) {
          idleSince = 0L
          val id = item.optString("id")
          val artistsJson = item.optJSONArray("artists")
          val artists = ArrayList<String>()
          if (artistsJson != null) for (k in 0 until artistsJson.length()) artists.add(artistsJson.getJSONObject(k).optString("name"))
          val queuedBefore = prefs(ctx).getString("queuedId", "") ?: ""
          executor.submit(Callable { trackStarted(ctx, id, artists, fromBroadcast = false) }).get()
          val remaining = item.optLong("duration_ms", 0L) - o.optLong("progress_ms", 0L)
          delay = if (queuedBefore == id) 5_000L else (remaining - 4_000L).coerceIn(2_500L, 45_000L)
        } else {
          if (idleSince == 0L) idleSince = now
          if (now - idleSince > IDLE_STOP_MS) {
            stop(ctx)
            setError(ctx, "Live DJ gestopt: er speelde een half uur niets.")
            return
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Live DJ kon de speler niet bekijken: ${e.message}")
      delay = 10_000L
    }
    handler?.postDelayed({ poll() }, delay)
  }

  private fun acquireWake(ctx: Context) {
    if (wakeLock?.isHeld == true) return
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FreakingDJ:live")
    wl.setReferenceCounted(false)
    wl.acquire(4 * 60 * 60 * 1000L)
    wakeLock = wl
  }

  private fun releaseWake() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (_: Exception) {
    }
    wakeLock = null
  }

  /** Na een herstart van de dienst: doorgaan als Live DJ nog actief was. */
  fun resumeIfActive(ctx: Context) {
    if (isActive(ctx) && SpotifyAuth.hasAuth(ctx)) ensureLoop(ctx)
  }
}
