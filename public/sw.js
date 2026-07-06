/* public/sw.js - Service Worker */

self.addEventListener("push", function (event) {
    console.log("Push received:", event);

    let data = {};
    if (event.data) {
        data = event.data.json();
    }

    const title = data.title || "eVoting system Pro";
    const options = {
        body: data.body || "You have a new notification",
        icon: "/favicon.png",
        badge: "/favicon.png",
        data: data, // keep any extra info
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
    console.log("Notification clicked:", event.notification);
    event.notification.close();

    const url = event.notification.data?.screen || "/";
    event.waitUntil(
        clients.matchAll({ type: "window" }).then(function (clientList) {
            for (const client of clientList) {
                if (client.url === url && "focus" in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});

