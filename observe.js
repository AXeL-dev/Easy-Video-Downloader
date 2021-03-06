/* globals app, prefs */
'use strict';
{
  const os = navigator.userAgent.indexOf('Firefox') !== -1 ? 'firefox' : (
    navigator.userAgent.indexOf('OPR') === -1 ? 'chrome' : 'opera'
  );

  const cache = {
    image: {},
    video: {},
    audio: {}
  };
  const clean = tabId => {
    delete cache.image[tabId];
    delete cache.video[tabId];
    delete cache.audio[tabId];
    const index = app.blockedIds.indexOf(tabId);
    if (index !== -1) {
      app.blockedIds.splice(index, 1);
    }
  };
  chrome.tabs.onRemoved.addListener(clean);

  function push(type, d) {
    if (prefs[type] === false) {
      return;
    }
    const tabId = d.tabId;
    cache[type][tabId] = cache[type][tabId] || {};
    const emit = !(d.url in cache[type][tabId]);
    cache[type][tabId][d.url] = d;
    if (emit) {
      app.emit('toolbar', {
        tabId,
        images: prefs.image ? Object.keys(cache.image[tabId] || {}).length : 0,
        videos: prefs.video ? Object.keys(cache.video[tabId] || {}).length : 0,
        audios: prefs.audio ? Object.keys(cache.audio[tabId] || {}).length : 0
      });
    }
  }

  function onHeadersReceived(d) {
    const {type, responseHeaders, tabId} = d;
    if (tabId < 0 || app.blockedIds.indexOf(tabId) !== -1) {
      return;
    }
    if (type === 'image') {
      push('image', d);
    }
    else {
      // prevent YouTube video link detection!
      if (os === 'chrome' && d.url.indexOf('googlevideo.') !== -1) {
        return;
      }

      const contentType = responseHeaders
        .filter(o => o.name === 'content-type' || o.name === 'Content-Type')
        .map(o => o.value).shift();
      //console.log(type, contentType, d)
      if (contentType) {
        if (
          contentType.startsWith('text/') ||
          contentType.startsWith('application/json')
        ) {
          return;
        }

        if (contentType.startsWith('image/')) {
          push('image', d);
        }
        if (contentType.startsWith('audio/')) {
          push('audio', d);
          if (type === 'media') {
            return;
          }
        }
        if (contentType.startsWith('video/')) {
          push('video', d);
          if (type === 'media') {
            return;
          }
        }
        // console.log(type, contentType);
        if (prefs.enabled && (
          type === 'other' ||
          type === 'main_frame' ||
          type === 'sub_frame'
        )) {
          chrome.tabs.get(d.tabId, tab => app.emit('command', {
            tab,
            download: d.url,
            responseHeaders: d.responseHeaders,
            instance: true
          }));
          return {
            // prevent page redirection
            redirectUrl: 'javascript:'
          };
        }
      }
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, response) => {
    if (request.method === 'requests') {
      const tabId = request.tabId;
      response({
        videos: cache.video[tabId],
        audios: cache.audio[tabId],
        images: cache.image[tabId]
      });
    }
  });

  function onCommitted({tabId}) {
    clean(tabId);
    app.emit('toolbar', {
      tabId,
      images: 0,
      videos: 0,
      audios: 0
    });
  }

  const observe = {
    install: () => {
      observe.remove();
      chrome.webRequest.onBeforeRequest.addListener(onCommitted, {
        urls: ['<all_urls>'],
        types: ['main_frame']
      }, []);

      let types = [];
      if (prefs.enabled) {
        types.push('main_frame', 'sub_frame', 'other', 'object', 'xmlhttprequest');
      }
      if (prefs.image) {
        types.push('image', 'xmlhttprequest', 'other');
      }
      if (prefs.video || prefs.audio) {
        types.push('media', 'xmlhttprequest', 'other');
      }
      types = types.filter((s, i, l) => l.indexOf(s) === i);
      if (types.length) {
        //console.log(prefs, types);
        chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, {
          urls: ['*://*/*'],
          types
        }, ['responseHeaders', 'blocking']);
      }
    },
    remove: () => {
      chrome.webRequest.onBeforeRequest.removeListener(onCommitted);
      chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
    }
  };
  app.on('prefs.enabled', observe.install);
  app.on('prefs.audio', observe.install);
  app.on('prefs.video', observe.install);
  app.on('prefs.image', observe.install);
  app.on('ready', observe.install);
}
