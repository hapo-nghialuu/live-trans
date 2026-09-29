import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, useCameraPermission, useObjectOutput, isScannedCode, type ScannedObject } from 'react-native-vision-camera';
import { parseMicLink, baseFromLink, lookupMicLink, createSessionOnServer, RoomSocket, MicLink } from './src/protocol';
import { createAudioStreamer, AudioStreamer } from './src/audio';

type Phase = 'idle' | 'starting' | 'recording' | 'finishing';
type Caption = { id: number; vi: string; en: string; ja: string; status: string; error?: string };

const STATUS_LABEL: Record<string, string> = {
  waiting: 'Chờ điện thoại', ready: 'Sẵn sàng', connecting: 'Đang kết nối…',
  listening: 'Đang nghe tiếng Việt', finishing: 'Đang hoàn tất câu cuối…', paused: 'Đã dừng thu âm',
  error: 'Có lỗi xảy ra', closed: 'Phiên đã kết thúc',
};

const C = {
  bg: '#0B0E14', surface: '#151B26', surface2: '#1B2330', border: '#262F3F',
  text: '#E8EDF4', muted: '#8794A6', accent: '#4C8DFF', live: '#F2555A',
  ok: '#3FB96F', warn: '#E8B341', en: '#7FB2F0', ja: '#C9A7EB',
};

const STATUS_TONE: Record<string, string> = {
  ready: C.accent, connecting: C.warn, listening: C.live, finishing: C.warn,
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
  const [sessionCode, setSessionCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [link, setLink] = useState<MicLink>();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('Quét QR trên màn hình chính → sao chép liên kết → dán vào đây.');
  const [interim, setInterim] = useState('');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const socketRef = useRef<RoomSocket | undefined>(undefined);
  const audioRef = useRef<AudioStreamer | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<FlatList<Caption>>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const active = phase === 'starting' || phase === 'recording';

  const stopAudio = useCallback(() => {
    audioRef.current?.stop();
    clearTimeout(finishTimer.current);
  }, []);

  const halt = useCallback((notice?: string) => {
    stopAudio();
    setPhase('idle');
    if (notice) setMessage(notice);
  }, [stopAudio]);

  const onEvent = useCallback((event: any) => {
    switch (event.type) {
      case 'snapshot':
        setConnected(true);
        setConnecting(false);
        setInterim(event.interim || '');
        if (Array.isArray(event.captions)) setCaptions(event.captions.slice(-30));
        setStatus(event.status); if (event.message) setMessage(event.message);
        break;
      case 'status':
        setStatus(event.status); if (event.message) setMessage(event.message);
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
        setEnded(true); setConnected(false); setStatus('closed');
        halt(event.message || 'Phiên đã kết thúc. Tạo phiên mới trên màn hình chính.');
        socketRef.current?.close();
        break;
    }
  }, [halt, stopAudio]);

  const onState = useCallback((state: 'connecting' | 'open' | 'closed') => {
    if (state === 'connecting') setConnecting(true);
    else if (state === 'open') setConnecting(false);
    else { setConnected(false); setConnecting(false); halt('Đã mất kết nối. Kết nối lại rồi nhấn bắt đầu.'); }
  }, [halt]);

  const openSocket = useCallback((parsed: MicLink) => {
    setLink(parsed);
    setEnded(false); setCaptions([]); setInterim('');
    socketRef.current?.close();
    const socket = new RoomSocket(parsed, onEvent, onState);
    socketRef.current = socket;
    socket.connect();
    setMessage('Đang kết nối phiên…');
  }, [onEvent, onState]);

  const connect = useCallback(() => {
    try {
      const parsed = parseMicLink(linkText);
      setServerBase(baseFromLink(linkText));
      setSessionCode('');
      openSocket(parsed);
    } catch (e: any) {
      setMessage(e.message || 'Liên kết không hợp lệ.');
    }
  }, [linkText, openSocket]);

  const joinByCode = useCallback(async (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 6) return setMessage('Mã phiên gồm đúng 6 chữ số.');
    setConnecting(true); setMessage('Đang kiểm tra mã phiên…');
    try {
      const { url } = await lookupMicLink(serverBase, digits);
      setSessionCode(digits); setLinkText(url);
      openSocket(parseMicLink(url));
    } catch (e: any) {
      setMessage(e.message || 'Không tìm thấy phiên. Kiểm tra lại mã và máy chủ.');
    } finally { setConnecting(false); }
  }, [serverBase, openSocket]);

  const createNewSession = useCallback(async () => {
    if (!accessKey.trim()) return setMessage('Nhập mã truy cập để tạo phiên mới.');
    setCreating(true); setMessage('Đang tạo phiên mới…');
    try {
      const { code: newCode, micUrl } = await createSessionOnServer(serverBase, accessKey.trim());
      setSessionCode(newCode); setLinkText(micUrl);
      AsyncStorage.setItem('lt_accessKey', accessKey.trim()).catch(() => {});
      AsyncStorage.setItem('lt_serverBase', serverBase).catch(() => {});
      openSocket(parseMicLink(micUrl));
    } catch (e: any) {
      setMessage(e.message || 'Không tạo được phiên. Kiểm tra lại mã truy cập và máy chủ.');
    } finally { setCreating(false); }
  }, [accessKey, serverBase, openSocket]);

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
      setMessage('Mã QR không phải của Live Trans. Hãy quét mã trên màn hình chính.');
    }
  }, [joinByCode, openSocket]);

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
    if (!granted) return setMessage('Chưa có quyền camera. Cấp quyền trong Cài đặt để quét mã QR.');
    setScanning(true);
  }, [hasPermission, requestPermission]);

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
    if (!socketRef.current?.open) return setMessage('Chưa kết nối. Hãy kết nối lại.');
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
  }, [halt]);

  const stop = useCallback(() => {
    setPhase('finishing');
    stopAudio();
    socketRef.current?.send({ type: 'stop' });
    finishTimer.current = setTimeout(() => {
      setPhase('idle');
      setMessage('Chưa nhận được xác nhận dừng. Kết nối lại trước khi bắt đầu lượt mới.');
    }, 20000);
  }, [stopAudio]);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem('lt_accessKey'), AsyncStorage.getItem('lt_serverBase')])
      .then(([ak, sb]) => {
        if (ak) setAccessKey(ak);
        if (sb) setServerBase(sb);
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
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const micLabel = recording ? 'Đang thu — chạm để dừng'
    : phase === 'starting' ? 'Đang kết nối dịch vụ…'
    : phase === 'finishing' ? 'Đang hoàn tất…' : 'Chạm để bắt đầu nói';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require('./assets/logo-mark.png')} style={styles.logo} />
            <View>
              <Text style={styles.brand}>Live Trans</Text>
              <Text style={styles.brandSub}>Micro điện thoại</Text>
            </View>
          </View>
          <View style={styles.pill}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <Text style={[styles.pillText, { color: tone }]}>{STATUS_LABEL[status] || status}</Text>
          </View>
        </View>

        {!!sessionCode && (
          <View style={styles.codeBanner}>
            <Text style={styles.codeBannerLabel}>MÃ PHIÊN</Text>
            <Text style={styles.codeBannerValue}>{sessionCode.slice(0, 3)} {sessionCode.slice(3)}</Text>
          </View>
        )}

        {!connected && (
          <View style={styles.card}>
            <Image source={require('./assets/logo-mark.png')} style={styles.hero} />
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, styles.firstBtn, pressed && styles.btnDim]}
              onPress={openScanner} accessibilityLabel="Quét mã QR">
              <Text style={styles.primaryBtnText}>Quét mã QR</Text>
            </Pressable>
            <Text style={styles.divider}>hoặc nhập mã phiên</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.codeInput} value={code}
                onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456" placeholderTextColor={C.muted}
                keyboardType="number-pad" maxLength={6} editable={!connecting}
              />
              <Pressable
                style={({ pressed }) => [styles.pasteBtn, pressed && styles.pressed]}
                onPress={() => joinByCode(code)} disabled={connecting} accessibilityLabel="Vào phiên bằng mã">
                <Text style={styles.pasteText}>Vào phiên</Text>
              </Pressable>
            </View>
            <Text style={styles.hostLabel}>MÁY CHỦ</Text>
            <TextInput
              style={styles.hostInput} value={serverBase} onChangeText={setServerBase}
              autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!connecting}
            />
            <Text style={styles.divider}>hoặc dán liên kết</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input} value={linkText} onChangeText={setLinkText}
                placeholder="…/mic.html#room=…&token=…" placeholderTextColor={C.muted}
                autoCapitalize="none" autoCorrect={false} editable={!connecting}
              />
              <Pressable
                style={({ pressed }) => [styles.pasteBtn, pressed && styles.pressed]}
                onPress={paste} accessibilityLabel="Dán liên kết">
                <Text style={styles.pasteText}>Dán</Text>
              </Pressable>
            </View>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, (connecting || pressed) && styles.btnDim]}
              onPress={connect} disabled={connecting}>
              <Text style={styles.primaryBtnText}>
                {connecting ? 'Đang kết nối…' : ended ? 'Kết nối phiên mới' : 'Kết nối'}
              </Text>
            </Pressable>
          </View>
        )}

        {!connected && (
          <View style={styles.card}>
            <Text style={styles.label}>Tạo phiên mới trên máy chủ</Text>
            <TextInput
              style={styles.input} value={accessKey} onChangeText={setAccessKey}
              placeholder="Mã truy cập máy chủ" placeholderTextColor={C.muted}
              autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!creating}
            />
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, (creating || pressed) && styles.btnDim]}
              onPress={createNewSession} disabled={creating}>
              <Text style={styles.primaryBtnText}>{creating ? 'Đang tạo…' : 'Tạo phiên mới'}</Text>
            </Pressable>
            <Text style={styles.createHint}>
              App tự vào vai trò mic. Đọc mã 6 số cho người ở màn hình web nhập vào để xem phụ đề.
            </Text>
          </View>
        )}

        <Text style={styles.message}>{message}</Text>

        {connected && (
          <View style={styles.micArea}>
            <View style={styles.micWrap}>
              {recording && (
                <Animated.View
                  style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
                />
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.micButton,
                  recording && styles.micButtonLive,
                  (pressed || phase === 'finishing' || phase === 'starting') && styles.btnDim,
                ]}
                disabled={phase === 'finishing' || (!active && ['connecting', 'listening', 'finishing'].includes(status))}
                onPress={() => (active ? stop() : start())}
                accessibilityLabel={recording ? 'Dừng thu âm' : 'Bắt đầu nói'}>
                {recording
                  ? <View style={styles.stopSquare} />
                  : <MicGlyph color={phase === 'starting' ? C.muted : '#fff'} />}
              </Pressable>
            </View>
            <Text style={styles.micLabel}>{micLabel}</Text>
            {!ended && (
              <Pressable onPress={reconnect} style={({ pressed }) => pressed && styles.pressed}>
                <Text style={styles.reconnect}>Kết nối lại</Text>
              </Pressable>
            )}
          </View>
        )}

        {!!interim && (
          <View style={styles.interimCard}>
            <Text style={styles.interimTag}>Đang nghe</Text>
            <Text style={styles.interim}>{interim}</Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          style={styles.captions} data={captions} keyExtractor={c => String(c.id)}
          contentContainerStyle={captions.length === 0 && styles.captionsEmpty}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            connected ? <Text style={styles.empty}>Phụ đề sẽ hiện ở đây khi bro bắt đầu nói.</Text> : <View />
          }
          renderItem={({ item }) => (
            <View style={styles.caption}>
              <Text style={styles.captionVi}>{item.vi}</Text>
              {item.status === 'done' ? (
                <>
                  <View style={styles.langRow}>
                    <Text style={[styles.langTag, { color: C.en }]}>EN</Text>
                    <Text style={styles.captionLang}>{item.en}</Text>
                  </View>
                  <View style={styles.langRow}>
                    <Text style={[styles.langTag, { color: C.ja }]}>JA</Text>
                    <Text style={styles.captionLang}>{item.ja}</Text>
                  </View>
                </>
              ) : (
                <Text style={[styles.captionPending, item.status === 'error' && { color: C.live }]}>
                  {item.status === 'error' ? `Lỗi dịch: ${item.error}` : 'Đang dịch…'}
                </Text>
              )}
            </View>
          )}
        />
      </KeyboardAvoidingView>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scannerRoot}>
          <Camera
            style={StyleSheet.absoluteFill} device="back"
            isActive={scanning} outputs={[objectOutput]}
          />
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Đưa mã QR trên màn hình vào khung</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1, paddingHorizontal: 20 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 8, paddingBottom: 16,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 40, height: 40, marginRight: 12 },
  brand: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.3 },
  brandSub: { color: C.muted, fontSize: 12, marginTop: 2 },
  hero: { width: 120, height: 120, alignSelf: 'center', marginBottom: 14 },
  pill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  pillText: { fontSize: 12.5, fontWeight: '600' },
  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 16, padding: 16, marginBottom: 12,
  },
  label: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontSize: 13, minHeight: 46,
  },
  pasteBtn: {
    marginLeft: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 16, minHeight: 46, justifyContent: 'center',
  },
  pasteText: { color: C.accent, fontSize: 14, fontWeight: '700' },
  divider: { color: C.muted, fontSize: 12, textAlign: 'center', marginVertical: 12 },
  codeInput: {
    flex: 1, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: 8,
    minHeight: 46, textAlign: 'center',
  },
  codeBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.accent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
  },
  codeBannerLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  codeBannerValue: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: 5 },
  createHint: { color: C.muted, fontSize: 11.5, marginTop: 10, lineHeight: 16 },
  hostLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
  hostInput: {
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    color: C.muted, fontSize: 12.5,
  },
  firstBtn: { marginTop: 0 },
  scannerRoot: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 230, height: 230, borderWidth: 3, borderColor: '#fff', borderRadius: 20, opacity: 0.9 },
  scanHint: { color: '#fff', marginTop: 26, fontSize: 14 },
  scanClose: {
    position: 'absolute', bottom: 60, paddingHorizontal: 30, paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999,
  },
  scanCloseText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: C.accent, borderRadius: 12, minHeight: 48,
    alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDim: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  message: { color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  micArea: { alignItems: 'center', paddingVertical: 18 },
  micWrap: { width: 168, height: 168, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute', width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.live,
  },
  micButton: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.accent, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  micButtonLive: { backgroundColor: C.live, shadowColor: C.live },
  stopSquare: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#fff' },
  micLabel: { color: C.muted, fontSize: 14, fontWeight: '600', marginTop: 14 },
  reconnect: { color: C.accent, fontSize: 14, fontWeight: '600', marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  interimCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 3, borderLeftColor: C.accent, borderRadius: 12,
    padding: 12, marginBottom: 10,
  },
  interimTag: { color: C.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  interim: { color: C.text, fontSize: 15, fontStyle: 'italic', lineHeight: 21 },
  captions: { flex: 1 },
  captionsEmpty: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: C.muted, fontSize: 14 },
  caption: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  captionVi: { color: C.text, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  langRow: { flexDirection: 'row', marginTop: 6, alignItems: 'flex-start' },
  langTag: { fontSize: 11, fontWeight: '800', width: 24, marginTop: 2 },
  captionLang: { flex: 1, color: C.text, fontSize: 14, lineHeight: 20 },
  captionPending: { color: C.muted, fontSize: 13, marginTop: 6, fontStyle: 'italic' },
});
