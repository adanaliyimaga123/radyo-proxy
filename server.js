function playStation(station, forceDirectStream = false) {
    if (isSwitching) return;
    isSwitching = true;
    setTimeout(() => { isSwitching = false; }, 800);

    clearAllStreamTimers();
    activeStation = station;
    if (settings.rememberLast) localStorage.setItem('lastStationId', station.id);

    currentTitle.innerText = station.name;
    songSubtitle.innerText = station.tags || "Canlı Radyo Yayını";
    songSubtitle.classList.add('active');

    updateNowPlayingLogo(station);
    renderVisibleList();
    renderQuickFavs();

    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (hls) {
      hls.destroy();
      hls = null;
    }
    isHlsActive = false;

    const compressing = !forceDirectStream && isCompressionActive();
    const usingProxyOnly = !forceDirectStream && !compressing && isProxyActive();
    const useLowStream = !compressing && !usingProxyOnly && !forceDirectStream && settings.preferLowBitrate && Boolean(station.lowUrl);
    
    let streamToPlay = station.url;
    if (compressing) {
      streamToPlay = buildStreamUrl(station.url, true);
    } else if (usingProxyOnly) {
      streamToPlay = buildStreamUrl(station.url, false);
    } else if (useLowStream) {
      streamToPlay = station.lowUrl;
    }

    statusText.innerText = (compressing || usingProxyOnly) ? "Proxy sunucusuna bağlanılıyor..." : "Bağlanıyor...";

    const handleStreamFailure = () => {
      // Eğer proxy/sıkıştırma modundaysak ve bağlantı kurulamadıysa doğrudan hata yönetimine git (autoReconnect tetiklensin)
      if (compressing || usingProxyOnly) {
        onPlayError("Proxy bağlantısı zaman aşımına uğradı");
        return;
      }
      if (useLowStream && station.url && station.url !== station.lowUrl) {
        playStation(station, true);
        return;
      }
      onPlayError();
    };

    // Proxy veya sıkıştırma modunda Render uykusundan uyanma süresi göz önüne alınarak süre artırıldı
    const timeoutMs = (compressing || usingProxyOnly) ? 45000 : 10000;

    deadLinkTimer = setTimeout(() => {
      if (!isPlaying) {
        handleStreamFailure();
      }
    }, timeoutMs);

    if (!compressing && !usingProxyOnly && streamToPlay.includes('.m3u8') && Hls.isSupported()) {
      isHlsActive = true;
      hls = new Hls({
        startLevel: -1,
        capLevelToPlayerSize: false,
        maxBufferLength: 25,
        maxMaxBufferLength: 40
      });

      hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        if (data && data.frag && data.frag.stats) {
          const loadedBytes = data.frag.stats.total || data.frag.stats.loaded || 0;
          totalBytesConsumed += loadedBytes;
          updateDataUsageBadge();
        }
      });

      hls.loadSource(streamToPlay);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        setupAudioContext();
        audio.play().then(() => onPlaySuccess(false, false, false)).catch(handleStreamFailure);
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) handleStreamFailure();
      });
    } else {
      audio.src = streamToPlay;
      setupAudioContext();
      audio.play().then(() => {
        onPlaySuccess(useLowStream, compressing, usingProxyOnly);
        startFallbackMeter(station, useLowStream, compressing);
      }).catch(handleStreamFailure);
    }

    audio.onerror = () => {
      handleStreamFailure();
    };

    updateMediaSession(station);
    if (settings.enableMeta) fetchMetadata(station);
  }
