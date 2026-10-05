import React from 'react';
import {StyleSheet, View} from 'react-native';

export type IconName =
  | 'qr' | 'keypad' | 'link' | 'clipboard' | 'plus' | 'settings'
  | 'chevron-down' | 'chevron-up' | 'close' | 'mic' | 'stop'
  | 'exit' | 'refresh' | 'captions';

type AppIconProps = {name: IconName; color?: string; size?: number};

/** All glyphs share a 24-point canvas and two-point rounded strokes. */
export function AppIcon({name, color = '#007A50', size = 24}: AppIconProps) {
  const line = (x1: number, y1: number, x2: number, y2: number, key?: string) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    return <View key={key} style={[styles.stroke, {
      left: (x1 + x2 - length) / 2, top: (y1 + y2) / 2 - 1,
      width: length, backgroundColor: color,
      transform: [{rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad`}],
    }]} />;
  };
  const box = (x: number, y: number, width: number, height: number, radius = 2, key?: string) => (
    <View key={key} style={[styles.outline, {
      left: x, top: y, width, height, borderRadius: radius, borderColor: color,
    }]} />
  );
  const arrow = (up: boolean) => <>
    {line(6, up ? 15 : 9, 12, up ? 9 : 15)}
    {line(12, up ? 9 : 15, 18, up ? 15 : 9)}
  </>;
  let glyph: React.ReactNode;
  switch (name) {
    case 'qr':
      glyph = <>
        {box(3, 3, 7, 7, 1)}{box(14, 3, 7, 7, 1)}{box(3, 14, 7, 7, 1)}
        {line(15, 14, 15, 18)}{line(15, 18, 20, 18)}{line(20, 14, 20, 15)}
        {line(15, 21, 20, 21)}
      </>;
      break;
    case 'keypad':
      glyph = <>{[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => (
        <View key={`${x}-${y}`} style={[styles.dot, {left: x - 1.5, top: y - 1.5, backgroundColor: color}]} />
      )))}</>;
      break;
    case 'link':
      glyph = <>
        <View style={[styles.outline, styles.linkLeft, {borderColor: color}]} />
        <View style={[styles.outline, styles.linkRight, {borderColor: color}]} />
        {line(9, 15, 15, 9)}
      </>;
      break;
    case 'clipboard':
      glyph = <>{box(5, 5, 14, 16)}{box(9, 2, 6, 5)}{line(9, 11, 15, 11)}{line(9, 15, 15, 15)}</>;
      break;
    case 'plus':
      glyph = <>{line(5, 12, 19, 12)}{line(12, 5, 12, 19)}</>;
      break;
    case 'settings':
      glyph = <>
        {box(5, 5, 14, 14, 7)}{box(9, 9, 6, 6, 3)}
        {Array.from({length: 8}, (_, index) => {
          const angle = index * Math.PI / 4;
          return line(12 + Math.cos(angle) * 7, 12 + Math.sin(angle) * 7,
            12 + Math.cos(angle) * 10, 12 + Math.sin(angle) * 10, String(index));
        })}
      </>;
      break;
    case 'chevron-down': glyph = arrow(false); break;
    case 'chevron-up': glyph = arrow(true); break;
    case 'close':
      glyph = <>{line(6, 6, 18, 18)}{line(18, 6, 6, 18)}</>;
      break;
    case 'mic':
      glyph = <>
        {box(9, 2, 6, 13, 3)}
        <View style={[styles.micArc, {borderColor: color}]} />
        {line(12, 18, 12, 22)}{line(8, 22, 16, 22)}
      </>;
      break;
    case 'stop': glyph = box(5, 5, 14, 14, 3); break;
    case 'exit':
      glyph = <>
        {line(10, 3, 4, 3)}{line(4, 3, 4, 21)}{line(4, 21, 10, 21)}
        {line(10, 12, 21, 12)}{line(17, 8, 21, 12)}{line(21, 12, 17, 16)}
      </>;
      break;
    case 'refresh':
      glyph = <>
        <View style={[styles.refreshArc, {borderColor: color}]} />
        {line(19, 3, 19, 8)}{line(14, 8, 19, 8)}
      </>;
      break;
    case 'captions':
      glyph = <>
        {box(2, 4, 20, 16, 3)}{line(6, 9, 10, 9)}{line(14, 9, 18, 9)}
        {line(6, 14, 14, 14)}{line(17, 14, 18, 14)}
      </>;
      break;
  }
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{width: size, height: size}}>
      <View style={[styles.canvas, {
        left: (size - 24) / 2, top: (size - 24) / 2,
        transform: [{scale: size / 24}],
      }]}>{glyph}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {position: 'absolute', width: 24, height: 24},
  stroke: {position: 'absolute', height: 2, borderRadius: 1},
  outline: {position: 'absolute', borderWidth: 2},
  dot: {position: 'absolute', width: 3, height: 3, borderRadius: 1.5},
  linkLeft: {left: 2, top: 10, width: 13, height: 8, borderRadius: 4, transform: [{rotate: '-45deg'}]},
  linkRight: {left: 9, top: 6, width: 13, height: 8, borderRadius: 4, transform: [{rotate: '-45deg'}]},
  micArc: {
    position: 'absolute', left: 5, top: 10, width: 14, height: 10,
    borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 7, borderBottomRightRadius: 7,
  },
  refreshArc: {
    position: 'absolute', left: 4, top: 4, width: 16, height: 16,
    borderWidth: 2, borderRadius: 8, borderRightColor: 'transparent', transform: [{rotate: '-35deg'}],
  },
});
