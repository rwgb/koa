self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Koa', body: '' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.ico',
    })
  );
});
