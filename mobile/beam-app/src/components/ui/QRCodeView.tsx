import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import * as QR from 'qrcode';

interface QRCodeViewProps {
  value: string;
  size?: number; // pixels
  colorDark?: string;
  colorLight?: string;
  padding?: number; // modules of quiet zone (default 4)
}

export function QRCodeView({ value, size = 220, colorDark = '#0f172a', colorLight = 'transparent', padding = 4 }: QRCodeViewProps) {
  const matrix = useMemo(() => {
    const qr = (QR as any).create(value, { errorCorrectionLevel: 'M' });
    const count: number = qr.modules.size;
    const data: boolean[] = qr.modules.data;
    return { count, data };
  }, [value]);

  const moduleSize = Math.floor(size / (matrix.count + padding * 2));
  const pxSize = moduleSize * (matrix.count + padding * 2);

  const rows = [] as JSX.Element[];
  for (let y = -padding; y < matrix.count + padding; y++) {
    const cols = [] as JSX.Element[];
    for (let x = -padding; x < matrix.count + padding; x++) {
      const inBounds = x >= 0 && y >= 0 && x < matrix.count && y < matrix.count;
      const pos = y * matrix.count + x;
      const dark = inBounds ? matrix.data[pos] : false;
      cols.push(
        <View
          key={`c-${x}-${y}`}
          style={{ width: moduleSize, height: moduleSize, backgroundColor: dark ? colorDark : colorLight }}
        />
      );
    }
    rows.push(
      <View key={`r-${y}`} style={{ flexDirection: 'row' }}>
        {cols}
      </View>
    );
  }

  return <View style={[styles.container, { width: pxSize, height: pxSize }]}>{rows}</View>;
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
  },
});
