/**
 * InputChatBar.tsx — Simple edition, no shadows, no animations.
 */

import React, { memo, useCallback, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

type Props = {
  onSend: (text: string) => void;
  onTyping?: (text: string) => void;
};

const InputBar = ({ onSend, onTyping, }: Props) => {
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
  const inputRef = useRef<TextInput>(null);

  const hasText = text.trim().length > 0;

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      onTyping?.(value);
    },
    [onTyping]
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    setInputHeight(40);
    inputRef.current?.focus();
  }, [text, onSend]);

  const handleContentSizeChange = useCallback((e: any) => {
    setInputHeight(Math.min(e.nativeEvent.contentSize.height, 120));
  }, []);

  return (
    <View style={[styles.inputWrapper, { marginBottom: Platform.OS === 'ios' ? 4 : 5 }]}>


      {/* Text input */}
      <TextInput
        ref={inputRef}
        value={text}
        onChangeText={handleChange}
        placeholder="Type a message…"
        maxLength={500}
        multiline
        blurOnSubmit={false}
        onContentSizeChange={handleContentSizeChange}
        style={[styles.input, { height: Math.max(40, inputHeight) }]}
        placeholderTextColor="#8f8c8bff"
        onSubmitEditing={() => {
          if (Platform.OS !== 'web') handleSend();
        }}
        onKeyPress={(e) => {
          const { key, shiftKey } = e.nativeEvent as any;
          if (key === 'Enter' && !shiftKey) {
            e.preventDefault?.();
            handleSend();
          }
        }}
      />

      {/* Send / Mic button */}
      <TouchableOpacity
        style={[styles.sendButton, hasText && styles.sendButtonActive]}
        onPress={handleSend}
        activeOpacity={0.82}
      >
        {hasText ? (
          <View style={styles.sendInner}>
            <MaterialIcons name="send" size={18} color="#fff" />
          </View>
        ) : (
          <MaterialIcons name="mic" size={20} color="#fff" />
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 6,
    paddingVertical: 5,
    margin: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e3dedcff',
    borderRadius: 28,
  },
  attachCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FBE9E7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 1,
  },
  attachCircleActive: {
    backgroundColor: 'orange',
  },
  iconBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 38,
    height: 40,
    marginLeft: 2,
  },
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 9,
    marginHorizontal: 2,
    fontSize: 15,
    color: '#1A0A05',
    textAlignVertical: 'top',
    lineHeight: 21,
    ...(Platform.OS === 'web' && ({
      outlineStyle: 'none',
      outlineWidth: 0,
      boxShadow: 'none',
    } as any)),
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'orange',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 1,
    marginRight: 2,
  },
  sendButtonActive: {
    backgroundColor: '#289510ff',
  },
  sendInner: {
    marginLeft: 2,
  },
});

export default memo(InputBar);
