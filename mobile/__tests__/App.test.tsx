/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@react-native-clipboard/clipboard', () =>
  require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'),
);

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraPermission: () => ({ hasPermission: false, requestPermission: jest.fn() }),
  useObjectOutput: (options: unknown) => options,
  isScannedCode: () => false,
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
