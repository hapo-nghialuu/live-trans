import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable, StatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseMicLink, RoomSocket, MicLink } from './src/protocol';
import { createAudioStreamer, AudioStreamer } from './src/audio';

type Phase = 'idle' | 'starting' | 'recording' | 'finishing';
type Caption = { id: number; vi: string; en: string; ja: string; status: string; error?: string };

const STATUS_LABEL: Record<string, string> = {
  waiting: 'Chờ điện thoại', ready: 'Điện thoại đã kết nối', connecting: 'Đang kết nối nhận giọng nói…',
  listening: 'Đang nghe tiếng Việt', finishing: 'Đang hoàn tất câu cuối…', paused: 'Đã dừng thu âm',
  error: 'Có lỗi xảy ra', closed: 'Phiên đã kết thúc',
};

export default function App() {
  const [linkText, setLinkText] = useState('');
  const [link, setLink] = useState<MicLink>();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('Dán liên kết mic từ màn hình chính (quét QR → sao chép liên kết).');
  const [interim, setInterim] = useState('');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const socketRef = useRef<RoomSocket | undefined>(undefined);
  const audioRef = useRef<AudioStreamer | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  const connect = useCallback(() => {
    try {
      const parsed = parseMicLink(linkText);
      setLink(parsed);
      setEnded(false); setCaptions([]); setInterim('');
      socketRef.current?.close();
      const socket = new RoomSocket(parsed, onEvent, onState);
      socketRef.current = socket;
      socket.connect();
      setMessage('Đang kết nối phiên…');
    } catch (e: any) {
      setMessage(e.message || 'Liên kết không hợp lệ.');
    }
  }, [linkText, onEvent, onState]);

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

  useEffect(() => () => {
    stopAudio();
    audioRef.current?.dispose();
    socketRef.current?.close();
  }, [stopAudio]);

  useEffect(() => {
    if (phase === 'recording') clearTimeout(finishTimer.current);
  }, [phase]);

  const micLabel = phase === 'recording' ? 'Dừng thu âm'
    : phase === 'starting' ? 'Đang kết nối…'
    : phase === 'finishing' ? 'Đang hoàn tất…' : 'Bắt đầu nói';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>Live Trans — Micro</Text>
        {!connected && (
          <View style={styles.joinBox}>
            <TextInput
              style={styles.input} value={linkText} onChangeText={setLinkText}
              placeholder="https://…/mic.html#room=…&token=…" autoCapitalize="none"
              autoCorrect={false} multiline editable={!connecting}
            />
            <Pressable style={[styles.button, connecting && styles.disabled]} onPress={connect} disabled={connecting}>
              <Text style={styles.buttonText}>{connecting ? 'Đang kết nối…' : ended ? 'Kết nối phiên mới' : 'Kết nối'}</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.statusRow}>
          <View style={[styles.dot, status === 'listening' && styles.dotLive, status === 'error' && styles.dotErr]} />
          <Text style={styles.status}>{STATUS_LABEL[status] || status}</Text>
        </View>
        <Text style={styles.message}>{message}</Text>
        {connected && (
          <Pressable
            style={[styles.micButton, phase === 'recording' && styles.micLive, phase === 'finishing' && styles.disabled]}
            disabled={phase === 'finishing' || (!active && ['connecting', 'listening', 'finishing'].includes(status))}
            onPress={() => (active ? stop() : start())}>
            <Text style={styles.micText}>{micLabel}</Text>
          </Pressable>
        )}
        {connected && !ended && (
          <Pressable onPress={reconnect}><Text style={styles.reconnect}>Kết nối lại</Text></Pressable>
        )}
        {!!interim && <Text style={styles.interim}>{interim}</Text>}
        <FlatList
          style={styles.captions} data={captions} keyExtractor={c => String(c.id)}
          renderItem={({ item }) => (
            <View style={styles.caption}>
              <Text style={styles.captionVi}>{item.vi}</Text>
              {item.status === 'done' ? (
                <>
                  <Text style={styles.captionEn}>EN: {item.en}</Text>
                  <Text style={styles.captionJa}>JA: {item.ja}</Text>
                </>
              ) : (
                <Text style={styles.captionPending}>{item.status === 'error' ? `Lỗi: ${item.error}` : 'Đang dịch…'}</Text>
              )}
            </View>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1, padding: 20 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  joinBox: { marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 10, fontSize: 13, minHeight: 44 },
  button: { backgroundColor: '#0a66c2', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#999', marginRight: 8 },
  dotLive: { backgroundColor: '#1a9e4b' },
  dotErr: { backgroundColor: '#d33' },
  status: { fontSize: 15, fontWeight: '600' },
  message: { color: '#555', marginTop: 4, marginBottom: 10 },
  micButton: { backgroundColor: '#17324d', borderRadius: 10, padding: 16, alignItems: 'center' },
  micLive: { backgroundColor: '#b3261e' },
  micText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  reconnect: { color: '#0a66c2', textAlign: 'center', marginTop: 10, fontSize: 15 },
  interim: { marginTop: 12, fontSize: 15, fontStyle: 'italic', color: '#444' },
  captions: { flex: 1, marginTop: 12 },
  caption: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ccc', paddingVertical: 8 },
  captionVi: { fontSize: 15, fontWeight: '600' },
  captionEn: { fontSize: 14, marginTop: 2 },
  captionJa: { fontSize: 14, marginTop: 1 },
  captionPending: { fontSize: 13, color: '#888', marginTop: 2 },
});
