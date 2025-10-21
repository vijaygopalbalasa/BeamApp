import React from 'react';
import { View, ScrollView, StyleSheet, StatusBar, KeyboardAvoidingView, Platform, SafeAreaView } from 'react-native';
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
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={palette.background} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {scrollable ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  keyboardView: {
    flex: 1,
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
