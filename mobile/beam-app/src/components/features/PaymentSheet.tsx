import React, { useEffect } from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { Card } from '../ui/Card';
import { HeadingM, Body, Small } from '../ui/Typography';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';
import { DesignSystem as DS } from '../../design/system';
import { haptics } from '../../utils/haptics';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  amountLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  stage?: 'review' | 'submitting' | 'confirming' | 'done' | 'error';
  progress?: number; // 0..1
  footnote?: string;
}

export function PaymentSheet({ visible, title, subtitle, amountLabel, onCancel, onConfirm, stage = 'review', progress = 0, footnote }: Props) {
  const isBusy = stage === 'submitting' || stage === 'confirming';
  useEffect(() => {
    if (stage === 'done') {
      haptics.success();
    } else if (stage === 'error') {
      haptics.error();
    }
  }, [stage]);
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Card style={styles.card}>
            <HeadingM>{title}</HeadingM>
            {subtitle ? <Small style={styles.subtitle}>{subtitle}</Small> : null}
            {amountLabel ? <Body style={styles.amount}>{amountLabel}</Body> : null}
            {(stage === 'submitting' || stage === 'confirming') && (
              <View style={styles.progress}>
                <ProgressBar value={progress} />
                <Small style={styles.stage}>{stage === 'submitting' ? 'Submitting…' : 'Confirming…'}</Small>
              </View>
            )}
            <View style={styles.row}>
              <Button label="Cancel" variant="secondary" onPress={() => { haptics.light(); onCancel(); }} disabled={isBusy} />
              <Button label={isBusy ? 'Working…' : 'Confirm'} onPress={() => { haptics.light(); onConfirm(); }} disabled={isBusy} />
            </View>
            {footnote ? <Small style={styles.footnote}>{footnote}</Small> : null}
          </Card>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { padding: DS.spacing.lg },
  card: { padding: DS.spacing.lg, gap: DS.spacing.md },
  row: { flexDirection: 'row', gap: DS.spacing.sm },
  subtitle: { color: DS.colors.text.secondary },
  amount: { color: DS.colors.text.primary, fontSize: 20, fontWeight: '700' },
  progress: { gap: DS.spacing.xs },
  stage: { color: DS.colors.text.secondary },
  footnote: { color: DS.colors.text.secondary, textAlign: 'center' },
});
