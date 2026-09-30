import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, useCameraPermission, useObjectOutput, isScannedCode, type ScannedObject } from 'react-native-vision-camera';
import { parseMicLink, baseFromLink, normalizeBase, lookupMicLink, createSessionOnServer, RoomSocket, MicLink } from './src/protocol';
import { createAudioStreamer, AudioStreamer } from './src/audio';
import { C, styles } from './src/app-styles';
import { AppIcon } from './src/app-icon';
import { ConnectionScreen } from './src/connection-screen';
import { MicrophoneScreen, type Caption } from './src/microphone-screen';
import { ServerSettings } from './src/server-settings';

type Phase = 'idle' | 'starting' | 'recording' | 'finishing';

const STATUS_LABEL: Record<string, string> = {
  waiting: 'Chờ điện thoại', ready: 'Sẵn sàng', connecting: 'Đang kết nối…',
  listening: 'Đang nghe tiếng Việt', finishing: 'Đang hoàn tất câu cuối…', paused: 'Đã dừng thu âm',
  error: 'Có lỗi xảy ra', closed: 'Phiên đã kết thúc',
};

const STATUS_TONE: Record<string, string> = {
  ready: C.ok, connecting: C.warn, listening: C.live, finishing: C.warn,
  paused: C.muted, error: C.live, closed: C.muted, waiting: C.muted,
};

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
  const [showCreate, setShowCreate] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
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
        setShowCaptions(false); setCaptions([]); setInterim('');
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

  const tone = STATUS_TONE[status] || C.muted;
  const statusBackground = status === 'listening' ? C.liveSoft
    : ['connecting', 'finishing'].includes(status) ? C.warnSoft
    : ['ready', 'paused'].includes(status) ? C.okSoft : C.surface2;
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const leave = () => {
    const close = () => {
      stopAudio(); audioRef.current?.dispose(); socketRef.current?.close();
      setConnected(false); setConnecting(false); setLink(undefined); setPhase('idle');
      setStatus('idle'); setEnded(false); setSessionCode(''); setLinkText('');
      setCode(''); setCaptions([]); setInterim(''); setShowCaptions(false); note('');
    };
    if (active || phase === 'finishing') Alert.alert('Rời phiên?', 'Micro sẽ dừng. Phiên trên màn hình xem vẫn còn.', [
      { text: 'Ở lại', style: 'cancel' }, { text: 'Rời phiên', style: 'destructive', onPress: close },
    ]);
    else close();
  };
  const micDisabled = phase === 'starting' || phase === 'finishing'
    || (!active && ['connecting', 'listening', 'finishing'].includes(status));

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require('./assets/logo-mark.png')} style={styles.logo} accessibilityLabel="Live Trans" />
          <Text style={styles.brand}>Live Trans</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          onPress={connected ? leave : () => setShowServerOptions(true)} disabled={connecting || creating}
          accessibilityRole="button" accessibilityLabel={connected ? 'Rời phiên' : 'Mở cài đặt'}>
          <AppIcon name={connected ? 'exit' : 'settings'} />
        </Pressable>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!connected ? <ConnectionScreen
          code={code} setCode={setCode} linkText={linkText} setLinkText={setLinkText}
          customCode={customCode} setCustomCode={setCustomCode} accessKey={accessKey} setAccessKey={setAccessKey}
          connecting={connecting} creating={creating} needsKey={needsKey}
          message={message} noticeError={noticeError} flash={flash}
          canReconnect={!!link && !ended} showLink={showLinkOptions} toggleLink={() => setShowLinkOptions(v => !v)}
          showCreate={showCreate} toggleCreate={() => setShowCreate(v => !v)}
          scan={openScanner} join={() => joinByCode(code)} connect={connect} paste={paste}
          create={createNewSession} reconnect={reconnect} />
          : <MicrophoneScreen phase={phase} disabled={micDisabled} sessionCode={sessionCode}
            message={message} noticeError={noticeError} statusLabel={STATUS_LABEL[status] || 'Sẵn sàng'}
            tone={tone} statusBackground={statusBackground} ringScale={ringScale} ringOpacity={ringOpacity}
            interim={interim} captions={captions} showCaptions={showCaptions}
            toggleCaptions={() => setShowCaptions(v => !v)} onMic={() => active ? stop() : start()}
            copyCode={() => { Clipboard.setString(sessionCode); note('Đã sao chép mã phiên.'); }} />}
      </KeyboardAvoidingView>
      <ServerSettings visible={showServerOptions} close={() => setShowServerOptions(false)}
        serverBase={serverBase} setServerBase={setServerBase} accessKey={accessKey} setAccessKey={setAccessKey} />
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scannerRoot}>
          <Camera style={StyleSheet.absoluteFill} device="back" isActive={scanning} outputs={[objectOutput]} />
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Đưa mã QR vào khung để kết nối</Text>
          <Pressable style={({ pressed }) => [styles.scanClose, pressed && styles.pressed]}
            onPress={() => setScanning(false)} accessibilityRole="button" accessibilityLabel="Đóng camera">
            <AppIcon name="close" size={20} /><Text style={styles.scanCloseText}>Đóng</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
