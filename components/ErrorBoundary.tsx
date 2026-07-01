import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { palette } from '@/constants/theme';
import { reportError } from '@/lib/telemetry';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Top-level crash catcher. Wraps the app root so a rendering exception
 * doesn't leave the user staring at a blank white screen — they see a
 * branded "bir şeyler ters gitti" surface with a retry. Errors are forwarded
 * to telemetry (Sentry once configured).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.bg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: palette.danger,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          <Feather name="alert-triangle" size={32} color={palette.voltInk} />
        </View>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 28,
            lineHeight: 36,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            textAlign: 'center',
          }}
        >
          bir şeyler ters gitti
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.muted,
            fontSize: 14,
            lineHeight: 20,
            textAlign: 'center',
            marginTop: 10,
          }}
        >
          uygulamayı kurtarmaya çalışıyoruz. devam etmek için tekrar dene.
        </Text>
        <Pressable
          onPress={this.reset}
          style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1, marginTop: 24 })}
        >
          <View
            style={{
              backgroundColor: palette.volt,
              borderRadius: 999,
              paddingVertical: 16,
              paddingHorizontal: 28,
              flexDirection: 'row',
              alignItems: 'center',
              shadowColor: palette.volt,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.28,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Feather name="refresh-ccw" size={18} color={palette.voltInk} style={{ marginRight: 10 }} />
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.voltInk,
                fontSize: 15,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              tekrar dene
            </Text>
          </View>
        </Pressable>
        {/* Phase 0: always show the error message — we're still iterating in
            TestFlight and need real stack traces to diagnose. Move back behind
            __DEV__ before public launch. */}
        <Text
          selectable
          style={{
            fontFamily: 'JetBrainsMono_400Regular',
            color: palette.muted,
            fontSize: 11,
            lineHeight: 16,
            marginTop: 32,
            textAlign: 'left',
            paddingHorizontal: 8,
          }}
        >
          {String(this.state.error.message ?? this.state.error)}
          {this.state.error.stack
            ? '\n\n' + this.state.error.stack.split('\n').slice(0, 6).join('\n')
            : ''}
        </Text>
      </View>
    );
  }
}
