import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { HeadingL, Body, Small } from './ui/Typography';
import { palette, spacing } from '../design/tokens';

export type PaymentStage = 'creating' | 'signing' | 'broadcasting' | 'confirming' | 'success' | 'error';

interface PaymentFlowAnimationProps {
  stage: PaymentStage;
  message?: string;
  amount?: string | number;
}

export const PaymentFlowAnimation: React.FC<PaymentFlowAnimationProps> = ({
  stage,
  message,
  amount,
}) => {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const checkmarkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Progress bar animation
    const targetProgress = {
      creating: 0.2,
      signing: 0.4,
      broadcasting: 0.6,
      confirming: 0.8,
      success: 1,
      error: 0.5,
    }[stage];

    Animated.timing(progressAnim, {
      toValue: targetProgress,
      duration: 500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();

    // Pulse animation for active stages
    if (['creating', 'signing', 'broadcasting', 'confirming'].includes(stage)) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }

    // Success checkmark animation
    if (stage === 'success') {
      Animated.spring(checkmarkAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start();
    } else {
      checkmarkAnim.setValue(0);
    }
  }, [stage, progressAnim, pulseAnim, checkmarkAnim]);

  const getStageInfo = () => {
    switch (stage) {
      case 'creating':
        return { icon: '📝', title: 'Creating Bundle', color: palette.accentBlue };
      case 'signing':
        return { icon: '🔐', title: 'Signing Transaction', color: palette.accentPurple };
      case 'broadcasting':
        return { icon: '📡', title: 'Broadcasting to Mesh', color: palette.accentBlue };
      case 'confirming':
        return { icon: '⏳', title: 'Confirming Receipt', color: palette.warning };
      case 'success':
        return { icon: '✅', title: 'Payment Complete!', color: palette.success };
      case 'error':
        return { icon: '❌', title: 'Payment Failed', color: palette.danger };
    }
  };

  const stageInfo = getStageInfo();

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.1],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const checkmarkScale = checkmarkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const checkmarkRotate = checkmarkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      {/* Icon */}
      <Animated.View
        style={[
          styles.iconContainer,
          {
            transform: [{ scale: stage === 'success' ? checkmarkScale : pulseScale }],
            opacity: stage === 'success' ? 1 : pulseOpacity,
          },
        ]}
      >
        {stage === 'success' ? (
          <Animated.Text
            style={[
              styles.icon,
              {
                transform: [{ rotate: checkmarkRotate }],
              },
            ]}
          >
            {stageInfo.icon}
          </Animated.Text>
        ) : (
          <Animated.Text style={styles.icon}>{stageInfo.icon}</Animated.Text>
        )}
      </Animated.View>

      {/* Title */}
      <HeadingL style={[styles.title, { color: stageInfo.color }]}>{stageInfo.title}</HeadingL>

      {/* Amount */}
      {amount && (
        <Body style={styles.amount}>
          ${typeof amount === 'number' ? (amount / 1_000_000).toFixed(2) : amount} USDC
        </Body>
      )}

      {/* Message */}
      {message && <Small style={styles.message}>{message}</Small>}

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <Animated.View
          style={[
            styles.progressBar,
            {
              width: progressWidth,
              backgroundColor: stageInfo.color,
            },
          ]}
        />
      </View>

      {/* Stage Indicators */}
      <View style={styles.stageIndicators}>
        {['creating', 'signing', 'broadcasting', 'confirming', 'success'].map((s, index) => {
          const isActive = ['creating', 'signing', 'broadcasting', 'confirming', 'success'].indexOf(stage) >= index;
          const isCurrent = s === stage;

          return (
            <View
              key={s}
              style={[
                styles.stageIndicator,
                {
                  backgroundColor: isActive ? stageInfo.color : 'rgba(148, 163, 184, 0.2)',
                  transform: [{ scale: isCurrent ? 1.2 : 1 }],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  iconContainer: {
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  amount: {
    color: palette.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  message: {
    color: palette.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  progressContainer: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  stageIndicators: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stageIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
