import React from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AppIcon } from './app-icon';
import { C, styles } from './app-styles';

type Props = {
  code: string; setCode: (value: string) => void;
  linkText: string; setLinkText: (value: string) => void;
  customCode: string; setCustomCode: (value: string) => void;
  accessKey: string; setAccessKey: (value: string) => void;
  connecting: boolean; creating: boolean; needsKey: boolean;
  message: string; noticeError: boolean; flash: Animated.Value;
  canReconnect: boolean; showLink: boolean; toggleLink: () => void;
  showCreate: boolean; toggleCreate: () => void;
  scan: () => void; join: () => void; connect: () => void;
  paste: () => void; create: () => void; reconnect: () => void;
};

export function ConnectionScreen(p: Props) {
  const busy = p.connecting || p.creating;
  return (
    <ScrollView contentContainerStyle={styles.welcomeContent} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <Text style={styles.title}>Kết nối phiên</Text>
        <Text style={styles.description}>Quét QR trên màn hình để dùng điện thoại làm micro.</Text>
      </View>
      {!!p.message && (p.noticeError || busy || p.canReconnect) && (
        <Animated.View style={[styles.notice, p.noticeError && styles.noticeError, { opacity: p.flash }]} accessibilityLiveRegion="polite">
          <Text style={[styles.noticeText, p.noticeError && styles.noticeErrorText]}>{p.message}</Text>
        </Animated.View>
      )}
      {p.canReconnect && !busy && (
        <Pressable style={styles.retryButton} onPress={p.reconnect} accessibilityRole="button">
          <AppIcon name="refresh" /><Text style={styles.retryText}>Kết nối lại phiên</Text>
        </Pressable>
      )}
      <View style={styles.card}>
        <Pressable style={({ pressed }) => [styles.scanButton, (busy || pressed) && styles.pressed]}
          onPress={p.scan} disabled={busy} accessibilityRole="button"
          accessibilityLabel="Quét mã QR để vào phiên" accessibilityState={{ disabled: busy }}>
          <AppIcon name="qr" color={C.surface} size={36} />
          <Text style={styles.primaryBtnText}>Quét mã QR</Text>
        </Pressable>
        <Text style={styles.fieldLabel}>Hoặc nhập mã phiên</Text>
        <View style={styles.inputRow}>
          <TextInput style={[styles.input, styles.codeInput]} value={p.code}
            onChangeText={v => p.setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000" placeholderTextColor={C.muted} keyboardType="number-pad"
            maxLength={6} editable={!busy} accessibilityLabel="Mã phiên 6 số" />
          <Pressable style={({ pressed }) => [styles.smallAction, (busy || pressed) && styles.pressed]}
            onPress={p.join} disabled={busy} accessibilityRole="button" accessibilityLabel="Vào phiên bằng mã"
            accessibilityState={{ disabled: busy }}>
            <Text style={styles.smallActionText}>{p.connecting ? 'Đợi…' : 'Vào'}</Text>
          </Pressable>
        </View>
        <Pressable style={styles.disclosure} onPress={p.toggleLink} disabled={busy}
          accessibilityRole="button" accessibilityLabel="Tùy chọn liên kết mic"
          accessibilityState={{ expanded: p.showLink, disabled: busy }}>
          <View style={styles.iconLabel}><AppIcon name="link" size={20} /><Text style={styles.disclosureText}>Dùng liên kết</Text></View>
          <AppIcon name={p.showLink ? 'chevron-up' : 'chevron-down'} size={18} />
        </Pressable>
        {p.showLink && (
          <View>
            <View style={styles.inputRow}>
              <TextInput style={styles.input} value={p.linkText} onChangeText={p.setLinkText}
                placeholder="Liên kết micro" placeholderTextColor={C.muted}
                autoCapitalize="none" autoCorrect={false} editable={!busy} accessibilityLabel="Liên kết mic" />
              <Pressable style={styles.outlineAction} onPress={p.paste} disabled={busy}
                accessibilityRole="button" accessibilityLabel="Dán liên kết từ bộ nhớ tạm">
                <AppIcon name="clipboard" size={22} />
              </Pressable>
            </View>
            <Pressable style={styles.secondaryBtn} onPress={p.connect} disabled={busy}
              accessibilityRole="button" accessibilityState={{ disabled: busy }}>
              <Text style={styles.secondaryBtnText}>Kết nối</Text>
            </Pressable>
          </View>
        )}
      </View>
      <View style={styles.createSection}>
        <Pressable style={styles.settingsHeader} onPress={p.toggleCreate} disabled={busy}
          accessibilityRole="button" accessibilityLabel="Tùy chọn tạo phiên mới"
          accessibilityState={{ expanded: p.showCreate || p.needsKey, disabled: busy }}>
          <View style={styles.iconLabel}><AppIcon name="plus" size={20} /><Text style={styles.settingsLabel}>Tạo phiên mới</Text></View>
          <AppIcon name={p.showCreate || p.needsKey ? 'chevron-up' : 'chevron-down'} size={18} />
        </Pressable>
        {(p.showCreate || p.needsKey) && (
          <View style={styles.createBody}>
            <Text style={styles.sectionHint}>Tạo mã rồi nhập mã này trên web để mở màn hình xem.</Text>
            <Text style={styles.fieldLabel}>Mã 6 số (không bắt buộc)</Text>
            <TextInput style={[styles.input, styles.standaloneInput]} value={p.customCode}
              onChangeText={v => p.setCustomCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="Tự tạo mã" placeholderTextColor={C.muted} keyboardType="number-pad"
              maxLength={6} editable={!busy} accessibilityLabel="Mã phiên tùy chọn, để trống để tự tạo" />
            {p.needsKey && (
              <>
                <Text style={styles.fieldLabel}>Mã truy cập máy chủ</Text>
                <TextInput style={[styles.input, styles.standaloneInput]} value={p.accessKey} onChangeText={p.setAccessKey}
                  placeholder="Nhập mã truy cập" placeholderTextColor={C.muted}
                  autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!busy}
                  accessibilityLabel="Mã truy cập máy chủ" />
              </>
            )}
            <Pressable style={styles.secondaryBtn} onPress={p.create} disabled={busy}
              accessibilityRole="button" accessibilityState={{ disabled: busy }}>
              <AppIcon name="plus" size={20} /><Text style={styles.secondaryBtnText}>{p.creating ? 'Đang tạo…' : 'Tạo phiên'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
