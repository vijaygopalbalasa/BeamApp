import React from 'react';
import { View, ScrollView, StyleSheet, StatusBar } from 'react-native';
import { palette, spacing } from '../../design/tokens';

interface ScreenProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  scrollable?: boolean;
  refreshControl?: React.ReactElement;
}

export function Screen({ children, header, footer, scrollable = true, refreshControl }: ScreenProps) {
  const content = (
    <View style={styles.content}>
      {header}
      <View style={styles.inner}>{children}</View>
      {footer}
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={palette.background} />
      {scrollable ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces
          refreshControl={refreshControl}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  content: {
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  inner: {
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
});
