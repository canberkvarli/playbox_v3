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
          backgroundColor: palette.paper,
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
            backgroundColor: palette.coral,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          <Feather name="alert-triangle" size={32} color={palette.paper} />
        </View>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 28,
            lineHeight: 32,
            textAlign: 'center',
          }}
        >
          bir şeyler ters gitti
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 14,
            lineHeight: 20,
            textAlign: 'center',
            marginTop: 10,
            opacity: 0.8,
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
              backgroundColor: palette.coral,
              borderRadius: 18,
              paddingVertical: 16,
              paddingHorizontal: 28,
              flexDirection: 'row',
              alignItems: 'center',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.28,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Feather name="refresh-ccw" size={18} color={palette.paper} style={{ marginRight: 10 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.paper,
                fontSize: 15,
                letterSpacing: 0.4,
              }}
            >
              tekrar dene
            </Text>
          </View>
        </Pressable>
        {__DEV__ ? (
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              color: palette.ink,
              fontSize: 11,
              marginTop: 32,
              opacity: 0.6,
              textAlign: 'center',
            }}
          >
            {String(this.state.error.message ?? this.state.error)}
          </Text>
        ) : null}
      </View>
    );
  }
}
