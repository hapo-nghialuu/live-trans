import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, useCameraPermission, useObjectOutput, isScannedCode, type ScannedObject } from 'react-native-vision-camera';
import { parseMicLink, baseFromLink, normalizeBase, lookupMicLink, createSessionOnServer, RoomSocket, MicLink } from './src/protocol';
import { createAudioStreamer, AudioStreamer } from './src/audio';
import { C, styles } from './src/app-styles';

type Phase = 'idle' | 'starting' | 'recording' | 'finishing';
type Caption = { id: number; vi: string; en: string; ja: string; status: string; error?: string };

const STATUS_LABEL: Record<string, string> = {
  waiting: 'Chờ điện thoại', ready: 'Sẵn sàng', connecting: 'Đang kết nối…',
  listening: 'Đang nghe tiếng Việt', finishing: 'Đang hoàn tất câu cuối…', paused: 'Đã dừng thu âm',
  error: 'Có lỗi xảy ra', closed: 'Phiên đã kết thúc',
};

const STATUS_TONE: Record<string, string> = {
  ready: C.ok, connecting: C.warn, listening: C.live, finishing: C.warn,
  paused: C.muted, error: C.live, closed: C.muted, waiting: C.muted,
};

function MicGlyph({ color }: { color: string }) {
  return (
    <View style={glyphStyles.wrap} accessibilityElementsHidden>
      <View style={[glyphStyles.capsule, { backgroundColor: color }]} />
      <View style={[glyphStyles.arc, { borderColor: color }]} />
      <View style={[glyphStyles.stem, { backgroundColor: color }]} />
      <View style={[glyphStyles.base, { backgroundColor: color }]} />
    </View>
  );
}

const glyphStyles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  capsule: { width: 16, height: 26, borderRadius: 8 },
  arc: {
    width: 32, height: 18, marginTop: -4,
    borderWidth: 2.5, borderTopColor: 'transparent',
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
  },
  stem: { width: 2.5, height: 9 },
  base: { width: 18, height: 2.5, borderRadius: 1.5 },
});

export default function App() {
  const [linkText, setLinkText] = useState('');
  const [code, setCode] = useState('');
  const [serverBase, setServerBase] = useState('https://live.hapo.work/');
  const [accessKey, setAccessKey] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showLinkOptions, setShowLinkOptions] = useState(false);
  const [showServerOptions, setShowServerOptions] = useState(false);
  const [link, setLink] = useState<MicLink>();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [interim, setInterim] = useState('');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const socketRef = useRef<RoomSocket | undefined>(undefined);
  const audioRef = useRef<AudioStreamer | undefined>(undefined);
  const lastNotice = useRef('');
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<FlatList<Caption>>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const active = phase === 'starting' || phase === 'recording';

  const stopAudio = useCallback(() => {
    audioRef.current?.stop();
    clearTimeout(finishTimer.current);
  }, []);

  const flash = useRef(new Animated.Value(1)).current;

  const note = useCallback((text: string, error = false) => {
    lastNotice.current = error ? text : '';
    setMessage(text);
    setNoticeError(error);
    flash.setValue(0.15);
    Animated.timing(flash, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [flash]);

  const halt = useCallback((notice?: string) => {
    stopAudio();
    setPhase('idle');
    if (notice) note(notice, true);
  }, [stopAudio, note]);

  const onEvent = useCallback((event: any) => {
    switch (event.type) {
      case 'snapshot':
        lastNotice.current = '';
        setConnected(true);
        setConnecting(false);
        setInterim(event.interim || '');
        if (Array.isArray(event.captions)) setCaptions(event.captions.slice(-30));
        setStatus(event.status); if (event.message) note(event.message);
        break;
      case 'status':
        setStatus(event.status); if (event.message) note(event.message);
        if (event.status === 'finishing') { stopAudio(); setPhase(p => (p === 'idle' ? p : 'finishing')); }
        else if (['paused', 'idle', 'ready', 'error'].includes(event.status)) {
          clearTimeout(finishTimer.current); stopAudio(); setPhase('idle');
        }
        break;
      case 'ready':
        setPhase('recording');
        audioRef.current?.start().catch(e => halt(e.message || 'Không mở được micro.'));
        break;
      case 'interim':
        setInterim(event.text || '');
        break;
      case 'caption': {
        const caption = event.caption as Caption;
        if (caption?.id != null) {
          setCaptions(list => {
            const i = list.findIndex(c => c.id === caption.id);
            const next = i === -1 ? [...list, caption] : list.map(c => (c.id === caption.id ? caption : c));
            return next.slice(-30);
          });
        }
        break;
      }
      case 'error':
        halt(event.message || 'Có lỗi xảy ra. Micro đã dừng.');
        break;
      case 'closed':
        setEnded(true); setConnected(false); setStatus('closed'); setSessionCode('');
        halt(event.message || 'Phiên đã kết thúc. Tạo phiên mới trên màn hình chính.');
        socketRef.current?.close();
        break;
    }
  }, [halt, stopAudio, note]);

  const onState = useCallback((state: 'connecting' | 'open' | 'closed', info?: { code?: number; reason?: string }) => {
    if (state === 'connecting') setConnecting(true);
    else if (state === 'open') { setConnecting(false); note('Đã kết nối máy chủ — đang vào phiên…'); }
    else {
      setConnected(false); setConnecting(false);
      const detail = info?.code || info?.reason ? ` (mã ${info?.code ?? '—'}: ${info?.reason || 'không rõ'})` : '';
      halt(lastNotice.current || `Đã mất kết nối${detail}. Kết nối lại rồi nhấn bắt đầu.`);
    }
  }, [halt, note]);

  const openSocket = useCallback((parsed: MicLink) => {
    lastNotice.current = '';
    setLink(parsed);
    setEnded(false); setCaptions([]); setInterim('');
    socketRef.current?.close();
    const socket = new RoomSocket(parsed, onEvent, onState);
    socketRef.current = socket;
    socket.connect();
    note('Đang kết nối phiên…');
  }, [onEvent, onState, note]);

  const joinByCode = useCallback(async (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 6) return note('Mã phiên gồm đúng 6 chữ số.', true);
    setConnecting(true); note('Đang kiểm tra mã phiên…');
    try {
      const { url } = await lookupMicLink(serverBase, digits);
      setSessionCode(digits); setLinkText(url);
      openSocket(parseMicLink(url));
    } catch (e: any) {
      note(e.message || 'Không tìm thấy phiên. Kiểm tra lại mã và máy chủ.', true);
    } finally { setConnecting(false); }
  }, [serverBase, openSocket, note]);

  const connect = useCallback(() => {
    const input = linkText.trim();
    if (!input && code.trim()) { joinByCode(code); return; }
    if (!input) return note('Nhập mã 6 số, quét QR, hoặc dán liên kết mic trước.', true);
    if (/^\d{4,8}$/.test(input)) { setCode(input); joinByCode(input); return; }
    try {
      const parsed = parseMicLink(input);
      setServerBase(baseFromLink(input));
      setSessionCode('');
      openSocket(parsed);
    } catch (e: any) {
      note(e.message || 'Liên kết không hợp lệ.', true);
    }
  }, [linkText, code, joinByCode, openSocket, note]);

  const createNewSession = useCallback(async () => {
    const wanted = customCode.replace(/\D/g, '');
    if (wanted && wanted.length !== 6) return note('Mã phiên tự chọn cần đúng 6 chữ số, hoặc để trống để tự sinh.', true);
    setCreating(true); note('Đang tạo phiên mới…');
    try {
      const { code: newCode, micUrl } = await createSessionOnServer(serverBase, accessKey.trim(), wanted);
      setSessionCode(newCode); setLinkText(micUrl); setCustomCode('');
      AsyncStorage.setItem('lt_serverBase', normalizeBase(serverBase)).catch(() => {});
      if (accessKey.trim()) AsyncStorage.setItem('lt_accessKey', accessKey.trim()).catch(() => {});
      openSocket(parseMicLink(micUrl));
    } catch (e: any) {
      if (e.status === 401) setNeedsKey(true);
      note(e.message || 'Không tạo được phiên. Kiểm tra lại máy chủ.', true);
    } finally { setCreating(false); }
  }, [accessKey, customCode, serverBase, openSocket, note]);

  const handleScanned = useCallback((raw: string) => {
    const value = raw.trim();
    if (/^\d{4,8}$/.test(value)) { setCode(value); joinByCode(value); return; }
    try {
      const parsed = parseMicLink(value);
      setLinkText(value);
      setServerBase(baseFromLink(value));
      setSessionCode('');
      openSocket(parsed);
    } catch {
      note('Mã QR không phải của Live Trans. Hãy quét mã trên màn hình chính.', true);
    }
  }, [joinByCode, openSocket, note]);

  const { hasPermission, requestPermission } = useCameraPermission();
  const objectOutput = useObjectOutput({
    types: ['qr'],
    onObjectsScanned: useCallback((objects: ScannedObject[]) => {
      const value = objects.find(isScannedCode)?.value;
      if (value) { setScanning(false); handleScanned(value); }
    }, [handleScanned]),
  });

  const openScanner = useCallback(async () => {
    const granted = hasPermission || await requestPermission();
    if (!granted) return note('Chưa có quyền camera. Cấp quyền trong Cài đặt để quét mã QR.', true);
    setScanning(true);
  }, [hasPermission, requestPermission, note]);

  const paste = useCallback(async () => {
    const text = await Clipboard.getString();
    if (text.trim()) setLinkText(text.trim());
  }, []);

  const reconnect = useCallback(() => {
    if (!link) return;
    socketRef.current?.close();
    const socket = new RoomSocket(link, onEvent, onState);
    socketRef.current = socket;
    socket.connect();
  }, [link, onEvent, onState]);

  const start = useCallback(() => {
    if (!socketRef.current?.open) return note('Chưa kết nối. Hãy kết nối lại.', true);
    try {
      audioRef.current?.dispose();
      const socket = socketRef.current;
      audioRef.current = createAudioStreamer(bytes => {
        if (socket.bufferedAmount + bytes.byteLength > 128 * 1024) {
          halt('Mạng không theo kịp âm thanh. Micro đã dừng; kiểm tra mạng rồi bắt đầu lại.');
        } else if (!socket.send(bytes)) halt('Gửi âm thanh thất bại. Micro đã dừng; kiểm tra kết nối.');
      });
      setPhase('starting');
      if (!socket.send({ type: 'start' })) throw new Error('Không gửi được yêu cầu thu âm.');
      finishTimer.current = setTimeout(() => halt('Dịch vụ nhận giọng nói chưa sẵn sàng. Hãy thử lại.'), 25000);
    } catch (e: any) { halt(e.message); }
  }, [halt, note]);

  const stop = useCallback(() => {
    setPhase('finishing');
    stopAudio();
    socketRef.current?.send({ type: 'stop' });
    finishTimer.current = setTimeout(() => {
      setPhase('idle');
      note('Chưa nhận được xác nhận dừng. Kết nối lại trước khi bắt đầu lượt mới.', true);
    }, 20000);
  }, [stopAudio, note]);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem('lt_accessKey'), AsyncStorage.getItem('lt_serverBase')])
      .then(([ak, sb]) => {
        if (ak) setAccessKey(ak);
        if (sb) { try { setServerBase(normalizeBase(sb)); } catch { setServerBase(sb); } }
      }).catch(() => {});
  }, []);

  useEffect(() => () => {
    stopAudio();
    audioRef.current?.dispose();
    socketRef.current?.close();
  }, [stopAudio]);

  useEffect(() => {
    if (phase === 'recording') clearTimeout(finishTimer.current);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'recording') { pulse.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const recording = phase === 'recording';
  const tone = STATUS_TONE[status] || C.muted;
  const statusBackground = status === 'listening' ? C.liveSoft
    : ['connecting', 'finishing'].includes(status) ? C.warnSoft
    : ['ready', 'paused'].includes(status) ? C.okSoft : C.surface2;
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const micLabel = recording ? 'Đang thu — chạm để dừng'
    : phase === 'starting' ? 'Đang kết nối dịch vụ…'
    : phase === 'finishing' ? 'Đang hoàn tất…' : 'Chạm để bắt đầu nói';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require('./assets/logo-mark.png')} style={styles.logo} accessibilityLabel="Live Trans" />
          <View>
            <Text style={styles.brand}>Live Trans</Text>
            <Text style={styles.brandSub}>Phụ đề trực tiếp</Text>
          </View>
        </View>
        {connected && (
          <View style={[styles.pill, { backgroundColor: statusBackground }]}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <Text style={[styles.pillText, { color: tone }]}>{STATUS_LABEL[status] || 'Đã kết nối'}</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!connected ? (
          <ScrollView contentContainerStyle={styles.welcomeContent} keyboardShouldPersistTaps="handled">
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>DỊCH GIỌNG NÓI TRỰC TIẾP</Text>
              <Text style={styles.title}>Nói tiếng Việt.{'\n'}Cả phòng cùng hiểu.</Text>
              <Text style={styles.description}>Dùng điện thoại làm micro. Phụ đề tiếng Việt, Anh và Nhật hiện trên màn hình của mọi người.</Text>
            </View>

            {!!message && (
              <Animated.View style={[styles.notice, noticeError && styles.noticeError, { opacity: flash }]} accessibilityLiveRegion="polite">
                <Text style={[styles.noticeText, noticeError && styles.noticeErrorText]}>{message}</Text>
              </Animated.View>
            )}

            {!!link && !ended && !connecting && (
              <Pressable style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]} onPress={reconnect} accessibilityRole="button">
                <Text style={styles.retryText}>Kết nối lại phiên vừa mở</Text>
              </Pressable>
            )}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Tham gia phiên</Text>
              <Text style={styles.sectionHint}>Quét mã QR trên màn hình xem để kết nối nhanh nhất.</Text>
              <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} onPress={openScanner} accessibilityRole="button" accessibilityLabel="Quét mã QR để vào phiên">
                <Text style={styles.primaryBtnText}>Quét mã QR</Text>
              </Pressable>
              <Text style={styles.fieldLabel}>Hoặc nhập mã phiên 6 số</Text>
              <View style={styles.inputRow}>
                <TextInput style={[styles.input, styles.codeInput]} value={code}
                  onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" placeholderTextColor={C.muted} keyboardType="number-pad"
                  maxLength={6} editable={!connecting} accessibilityLabel="Mã phiên 6 số" />
                <Pressable style={({ pressed }) => [styles.smallAction, (connecting || pressed) && styles.pressed]}
                  onPress={() => joinByCode(code)} disabled={connecting} accessibilityRole="button" accessibilityLabel="Vào phiên bằng mã">
                  <Text style={styles.smallActionText}>{connecting ? 'Đang vào…' : 'Vào phiên'}</Text>
                </Pressable>
              </View>

              <Pressable style={styles.disclosure} onPress={() => setShowLinkOptions(value => !value)} accessibilityRole="button" accessibilityLabel="Tùy chọn liên kết mic" accessibilityState={{ expanded: showLinkOptions }}>
                <Text style={styles.disclosureText}>Dùng liên kết mic</Text>
                <Text style={styles.disclosureChevron}>{showLinkOptions ? '−' : '+'}</Text>
              </Pressable>
              {showLinkOptions && (
                <View style={styles.disclosureBody}>
                  <Text style={styles.fieldLabel}>Liên kết từ màn hình xem</Text>
                  <View style={styles.inputRow}>
                    <TextInput style={styles.input} value={linkText} onChangeText={setLinkText}
                      placeholder="Dán liên kết mic" placeholderTextColor={C.muted}
                      autoCapitalize="none" autoCorrect={false} editable={!connecting}
                      accessibilityLabel="Liên kết mic" />
                    <Pressable style={({ pressed }) => [styles.outlineAction, pressed && styles.pressed]}
                      onPress={paste} accessibilityRole="button" accessibilityLabel="Dán liên kết từ bộ nhớ tạm">
                      <Text style={styles.outlineActionText}>Dán</Text>
                    </Pressable>
                  </View>
                  <Pressable style={({ pressed }) => [styles.secondaryBtn, (connecting || pressed) && styles.pressed]}
                    onPress={connect} disabled={connecting} accessibilityRole="button">
                    <Text style={styles.secondaryBtnText}>{connecting ? 'Đang kết nối…' : 'Kết nối bằng liên kết'}</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Bắt đầu phiên mới</Text>
              <Text style={styles.sectionHint}>Tạo mã phiên rồi gửi mã cho người xem nhập trên web.</Text>
              <Text style={styles.fieldLabel}>Mã 6 số tùy chọn</Text>
              <TextInput style={[styles.input, styles.createCodeInput]} value={customCode}
                onChangeText={v => setCustomCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="Để trống để tự tạo" placeholderTextColor={C.muted}
                keyboardType="number-pad" maxLength={6} editable={!creating}
                accessibilityLabel="Mã phiên tùy chọn, để trống để tự tạo" />
              {needsKey && (
                <>
                  <Text style={styles.fieldLabel}>Mã truy cập máy chủ</Text>
                  <TextInput style={styles.input} value={accessKey} onChangeText={setAccessKey}
                    placeholder="Nhập mã truy cập" placeholderTextColor={C.muted}
                    autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!creating}
                    accessibilityLabel="Mã truy cập máy chủ" />
                </>
              )}
              <Pressable style={({ pressed }) => [styles.secondaryBtn, (creating || pressed) && styles.pressed]}
                onPress={createNewSession} disabled={creating} accessibilityRole="button">
                <Text style={styles.secondaryBtnText}>{creating ? 'Đang tạo phiên…' : 'Tạo phiên mới'}</Text>
              </Pressable>
            </View>

            <View style={styles.settingsCard}>
              <Pressable style={styles.settingsHeader} onPress={() => setShowServerOptions(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: showServerOptions }}>
                <Text style={styles.settingsLabel}>Địa chỉ máy chủ</Text>
                <Text style={styles.settingsValue}>{showServerOptions ? 'Đóng' : 'Thay đổi'}</Text>
              </Pressable>
              {showServerOptions && (
                <TextInput style={[styles.input, styles.serverInput]} value={serverBase} onChangeText={setServerBase}
                  onBlur={() => { try { setServerBase(normalizeBase(serverBase)); } catch {} }}
                  autoCapitalize="none" autoCorrect={false} keyboardType="url"
                  editable={!connecting} accessibilityLabel="Địa chỉ máy chủ" />
              )}
            </View>
          </ScrollView>
        ) : (
          <View style={styles.sessionContent}>
            {!!sessionCode && (
              <View style={styles.codeBanner}>
                <View>
                  <Text style={styles.codeBannerLabel}>MÃ PHIÊN ĐỂ NGƯỜI XEM THAM GIA</Text>
                  <Text style={styles.codeBannerValue}>{sessionCode.slice(0, 3)} {sessionCode.slice(3)}</Text>
                </View>
                <View style={styles.codeBadge}><Text style={styles.codeBadgeText}>WEB</Text></View>
              </View>
            )}

            <View style={[styles.sessionNotice, noticeError && styles.noticeError]} accessibilityLiveRegion="polite">
              <Text style={[styles.sessionNoticeText, noticeError && styles.noticeErrorText]}>{message}</Text>
            </View>

            <View style={styles.micPanel}>
              <Text style={styles.micTitle}>{recording ? 'Đang thu tiếng Việt'
                : phase === 'starting' ? 'Đang chuẩn bị micro'
                : phase === 'finishing' ? 'Đang hoàn tất câu cuối' : 'Micro đã sẵn sàng'}</Text>
              <Text style={styles.micSubtitle}>{recording ? 'Nói tự nhiên, ngắt ngắn giữa các câu.'
                : phase === 'starting' ? 'Đợi dịch vụ nhận giọng nói sẵn sàng.'
                : phase === 'finishing' ? 'Phụ đề cuối sẽ xuất hiện sau ít giây.'
                : 'Mở màn hình phụ đề cho người xem, rồi bắt đầu nói.'}</Text>
              <View style={styles.micWrap}>
                {recording && (
                  <Animated.View style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
                )}
                <Pressable style={({ pressed }) => [styles.micButton, recording && styles.micButtonLive,
                  (pressed || phase === 'finishing' || phase === 'starting') && styles.pressed]}
                  disabled={phase === 'finishing' || (!active && ['connecting', 'listening', 'finishing'].includes(status))}
                  onPress={() => (active ? stop() : start())} accessibilityRole="button"
                  accessibilityLabel={recording ? 'Dừng thu âm' : 'Bắt đầu thu âm'}
                  accessibilityState={{ disabled: phase === 'finishing' || (!active && ['connecting', 'listening', 'finishing'].includes(status)) }}>
                  {recording ? <View style={styles.stopSquare} /> : <MicGlyph color="#FFFFFF" />}
                </Pressable>
              </View>
              <Text style={styles.micLabel}>{micLabel}</Text>
            </View>

            <View style={styles.transcriptHeader}>
              <Text style={styles.sectionTitle}>Phụ đề</Text>
              <Text style={styles.transcriptHint}>VI · EN · JA</Text>
            </View>
            {!!interim && (
              <View style={styles.interimCard}>
                <Text style={styles.interimTag}>TIẾNG VIỆT · ĐANG NGHE</Text>
                <Text style={styles.interim}>{interim}</Text>
              </View>
            )}
            <FlatList ref={listRef} style={styles.captions} data={captions}
              keyExtractor={item => String(item.id)} contentContainerStyle={styles.captionList}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              ListEmptyComponent={<View style={styles.emptyCard}><Text style={styles.emptyTitle}>Phụ đề sẽ xuất hiện ở đây</Text><Text style={styles.empty}>Bấm nút micro và bắt đầu nói khi màn hình xem đã mở.</Text></View>}
              renderItem={({ item }) => (
                <View style={styles.caption}>
                  <Text style={styles.captionVi}>{item.vi}</Text>
                  {item.status === 'done' ? (
                    <>
                      <View style={styles.langRow}><Text style={[styles.langTag, { color: C.en }]}>EN</Text><Text style={styles.captionLang}>{item.en}</Text></View>
                      <View style={styles.langRow}><Text style={[styles.langTag, { color: C.ja }]}>JA</Text><Text style={styles.captionLang}>{item.ja}</Text></View>
                    </>
                  ) : <Text style={[styles.captionPending, item.status === 'error' && styles.captionError]}>{item.status === 'error' ? `Chưa dịch được: ${item.error}` : 'Đang dịch…'}</Text>}
                </View>
              )} />
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scannerRoot}>
          <Camera
            style={StyleSheet.absoluteFill} device="back"
            isActive={scanning} outputs={[objectOutput]}
          />
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Đưa mã QR trên màn hình xem vào khung</Text>
          <Pressable
            style={({ pressed }) => [styles.scanClose, pressed && styles.pressed]}
            onPress={() => setScanning(false)} accessibilityLabel="Đóng camera">
            <Text style={styles.scanCloseText}>Đóng</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
