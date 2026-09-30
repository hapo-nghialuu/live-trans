import React from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon } from './app-icon';
import { C, styles } from './app-styles';

export type Caption = { id: number; vi: string; en: string; ja: string; status: string; error?: string };
type Props = {
  phase: 'idle' | 'starting' | 'recording' | 'finishing'; disabled: boolean;
  sessionCode: string; message: string; noticeError: boolean;
  statusLabel: string; tone: string; statusBackground: string;
  ringScale: Animated.AnimatedInterpolation<number>;
  ringOpacity: Animated.AnimatedInterpolation<number>;
  interim: string; captions: Caption[]; showCaptions: boolean;
  toggleCaptions: () => void; onMic: () => void; copyCode: () => void;
};

export function MicrophoneScreen(p: Props) {
  const recording = p.phase === 'recording';
  const pending = p.phase === 'starting' || p.phase === 'finishing';
  return (
    <>
      <ScrollView contentContainerStyle={styles.sessionContent}>
        {!!p.sessionCode && (
          <Pressable style={styles.codeBanner} onPress={p.copyCode} accessibilityRole="button" accessibilityLabel="Sao chép mã phiên">
            <Text style={styles.codeBannerLabel}>Mã phiên</Text>
            <Text style={styles.codeBannerValue}>{p.sessionCode.slice(0, 3)} {p.sessionCode.slice(3)}</Text>
            <AppIcon name="clipboard" size={20} />
          </Pressable>
        )}
        <View style={styles.micPanel}>
          <View style={[styles.pill, { backgroundColor: p.statusBackground }]}>
            <View style={[styles.dot, { backgroundColor: p.tone }]} />
            <Text style={[styles.pillText, { color: p.tone }]}>{p.statusLabel}</Text>
          </View>
          <View style={styles.micWrap}>
            {recording && <Animated.View style={[styles.ring, { transform: [{ scale: p.ringScale }], opacity: p.ringOpacity }]} />}
            <Pressable style={({ pressed }) => [styles.micButton, recording && styles.micButtonLive, (pressed || p.disabled) && styles.pressed]}
              disabled={p.disabled} onPress={p.onMic} accessibilityRole="button"
              accessibilityLabel={recording ? 'Dừng thu âm' : 'Bắt đầu thu âm'}
              accessibilityState={{ disabled: p.disabled }}>
              {pending ? <ActivityIndicator color={C.surface} size="large" />
                : <AppIcon name={recording ? 'stop' : 'mic'} color={C.surface} size={48} />}
            </Pressable>
          </View>
          <Text style={styles.micTitle}>{recording ? 'Chạm để dừng' : p.phase === 'starting' ? 'Đang kết nối…'
            : p.phase === 'finishing' ? 'Đang hoàn tất…' : 'Bắt đầu nói'}</Text>
          <Text style={styles.micSubtitle}>{recording ? 'Nói tiếng Việt, ngắt nhẹ giữa các câu.'
            : pending ? 'Vui lòng đợi trong giây lát.' : 'Mở màn hình xem trước khi bật micro.'}</Text>
        </View>
        {p.noticeError && (
          <View style={[styles.notice, styles.noticeError]} accessibilityLiveRegion="polite">
            <Text style={[styles.noticeText, styles.noticeErrorText]}>{p.message}</Text>
          </View>
        )}
        {!!p.interim && (
          <View style={styles.interimCard}>
            <Text style={styles.interimTag}>ĐANG NGHE</Text><Text style={styles.interim} numberOfLines={3}>{p.interim}</Text>
          </View>
        )}
        <Pressable style={styles.captionLink} onPress={p.toggleCaptions} accessibilityRole="button" accessibilityLabel="Xem phụ đề và lịch sử">
          <View style={styles.iconLabel}><AppIcon name="captions" size={22} /><Text style={styles.settingsLabel}>Xem phụ đề</Text></View>
          <Text style={styles.captionCount}>{p.captions.length}</Text>
        </Pressable>
      </ScrollView>
      <Modal visible={p.showCaptions} animationType="slide" onRequestClose={p.toggleCaptions}>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}><Text style={styles.sectionTitle}>Phụ đề</Text><Pressable style={styles.iconButton}
            onPress={p.toggleCaptions} accessibilityRole="button" accessibilityLabel="Đóng phụ đề"><AppIcon name="close" /></Pressable></View>
          <ScrollView contentContainerStyle={styles.captionList}>
            {!!p.interim && <View style={styles.interimCard}><Text style={styles.interimTag}>ĐANG NGHE</Text><Text style={styles.interim}>{p.interim}</Text></View>}
            {!p.captions.length && <View style={styles.emptyCard}><AppIcon name="captions" size={32} /><Text style={styles.empty}>Phụ đề sẽ hiện khi bạn bắt đầu nói.</Text></View>}
            {[...p.captions].reverse().map(item => (
              <View key={item.id} style={styles.caption}>
                <Text style={styles.captionVi}>{item.vi}</Text>
                {item.status === 'done' ? (
                  <><View style={styles.langRow}><Text style={[styles.langTag, { color: C.en }]}>EN</Text><Text style={styles.captionLang}>{item.en}</Text></View>
                    <View style={styles.langRow}><Text style={[styles.langTag, { color: C.ja }]}>JA</Text><Text style={styles.captionLang}>{item.ja}</Text></View></>
                ) : <Text style={[styles.captionPending, item.status === 'error' && styles.captionError]}>{item.status === 'error' ? 'Chưa dịch được. Hãy thử nói lại.' : 'Đang dịch…'}</Text>}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
