import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon } from './app-icon';
import { C, styles } from './app-styles';
import { normalizeBase } from './protocol';

type Props = {
  visible: boolean; close: () => void; serverBase: string; setServerBase: (value: string) => void;
  accessKey: string; setAccessKey: (value: string) => void;
};
export function ServerSettings(p: Props) {
  return (
    <Modal visible={p.visible} animationType="slide" onRequestClose={p.close}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}><Text style={styles.sectionTitle}>Cài đặt</Text>
          <Pressable style={styles.iconButton} onPress={p.close} accessibilityRole="button" accessibilityLabel="Đóng cài đặt"><AppIcon name="close" /></Pressable></View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.welcomeContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Địa chỉ máy chủ</Text>
            <TextInput style={[styles.input, styles.standaloneInput]} value={p.serverBase} onChangeText={p.setServerBase}
              onBlur={() => { try { p.setServerBase(normalizeBase(p.serverBase)); } catch {} }}
              autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Địa chỉ máy chủ" />
            <Text style={styles.fieldLabel}>Mã truy cập (nếu máy chủ yêu cầu)</Text>
            <TextInput style={[styles.input, styles.standaloneInput]} value={p.accessKey} onChangeText={p.setAccessKey}
              secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Không bắt buộc" placeholderTextColor={C.muted}
              accessibilityLabel="Mã truy cập trong cài đặt" />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
