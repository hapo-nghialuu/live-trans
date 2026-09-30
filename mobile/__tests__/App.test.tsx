/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@react-native-clipboard/clipboard', () =>
  require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'),
);

jest.mock('@react-native-async-storage/async-storage');

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraPermission: () => ({ hasPermission: false, requestPermission: jest.fn() }),
  useObjectOutput: (options: unknown) => options,
  isScannedCode: () => false,
}));

test('shows quick join first and reveals optional mic link on demand', async () => {
  let screen: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(<App />);
  });

  expect(screen!.root.findAllByProps({ accessibilityLabel: 'Quét mã QR để vào phiên' }).length).toBeGreaterThan(0);
  expect(screen!.root.findAllByProps({ accessibilityLabel: 'Mã phiên 6 số' }).length).toBeGreaterThan(0);
  expect(screen!.root.findAllByProps({ accessibilityLabel: 'Liên kết mic' })).toHaveLength(0);

  await ReactTestRenderer.act(async () => {
    screen!.root.findAllByProps({ accessibilityLabel: 'Tùy chọn liên kết mic' })
      .find(node => typeof node.props.onPress === 'function')!.props.onPress();
  });
  expect(screen!.root.findAllByProps({ accessibilityLabel: 'Liên kết mic' }).length).toBeGreaterThan(0);
});

test('keeps create options behind an explicit control', async () => {
  let screen: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { screen = ReactTestRenderer.create(<App />); });
  expect(screen!.root.findAllByProps({ accessibilityLabel: 'Mã phiên tùy chọn, để trống để tự tạo' })).toHaveLength(0);
  await ReactTestRenderer.act(async () => {
    screen!.root.findAllByProps({ accessibilityLabel: 'Tùy chọn tạo phiên mới' })
      .find(node => typeof node.props.onPress === 'function')!.props.onPress();
  });
  expect(screen!.root.findAllByProps({ accessibilityLabel: 'Mã phiên tùy chọn, để trống để tự tạo' }).length).toBeGreaterThan(0);
  await ReactTestRenderer.act(async () => { screen!.unmount(); });
});
