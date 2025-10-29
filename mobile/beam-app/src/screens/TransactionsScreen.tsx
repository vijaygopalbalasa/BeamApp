import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { TransactionCard } from '../components/features/TransactionCard';
import { transactionHistory, type TransactionItem } from '../services/TransactionHistoryService';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { palette, spacing } from '../design/tokens';

interface Props { navigation: { navigate: (screen: string, params?: any) => void } }

export function TransactionsScreen({ navigation }: Props) {
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await transactionHistory.loadAll();
      setItems(all);
      setLoading(false);
    })();
  }, []);

  return (
    <Screen header={<Hero title="Transactions" subtitle="Your recent payments" />}>
      <Card style={styles.card}>
        {loading ? (
          <View>
            {[0,1,2,3].map(i => (
              <View key={i} style={{ paddingVertical: 12 }}>
                <Skeleton height={20} width={'60%'} />
                <Skeleton height={14} width={'40%'} style={{ marginTop: 6 }} />
              </View>
            ))}
          </View>
        ) : items.length === 0 ? (
          <EmptyState title="No transactions yet" subtitle="Payments you send or receive will show up here" />
        ) : (
          <FlatList
            data={items}
            keyExtractor={i => i.id}
            renderItem={({ item }) => (
              <TransactionCard item={item} onPress={(id) => navigation.navigate('TransactionDetails', { id })} />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
          />
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg },
});
