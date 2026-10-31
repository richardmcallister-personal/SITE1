// Service worker for match alerts: shows the pushed notification and opens the match centre when it is tapped.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Manchester United", body: e.data ? e.data.text() : "" }; }
  var body = d.body || "";
  if (d.kind === "kickoff" && d.ko) { try { var t = new Date(d.ko); body = "Kick-off " + t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " your time" + (body ? " · " + body : ""); } catch (err) {} }
  var opts = { body: body, icon: "/assets/icon-192.png", badge: "/assets/badge-96.png", tag: d.tag || "mu", renotify: true, data: { url: d.url || "/" }, timestamp: Date.now() };
  if (d.kind === "goal") opts.vibrate = [200, 100, 200];
  e.waitUntil(self.registration.showNotification(d.title || "Manchester United", opts));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close(); var url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) { for (var i = 0; i < cs.length; i++) { if ("focus" in cs[i]) { cs[i].navigate(url); return cs[i].focus(); } } return self.clients.openWindow(url); }));
});
