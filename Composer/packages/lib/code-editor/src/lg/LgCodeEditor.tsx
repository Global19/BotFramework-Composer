// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LgTemplate } from '@botframework-composer/types';
import { EditorDidMount } from '@monaco-editor/react';
import formatMessage from 'format-message';
import get from 'lodash/get';
import * as monacoEditor from 'monaco-editor';
import { MonacoLanguageClient, MonacoServices } from 'monaco-languageclient';
import { Stack } from 'office-ui-fabric-react/lib/Stack';
import React, { useEffect, useState } from 'react';
import { listen, MessageConnection } from 'vscode-ws-jsonrpc';

import { BaseEditor, BaseEditorProps, OnInit } from '../BaseEditor';
import { LG_HELP } from '../constants';
import { registerLGLanguage } from '../languages';
import { LGOption } from '../utils';
import { createLanguageClient, createUrl, createWebSocket, sendRequestWithRetry } from '../utils/lspUtil';

import { computeRequiredEdits } from './utils';
import { LgEditorToolbar } from './LgEditorToolbar';

const placeholder = formatMessage(
  `> To learn more about the LG file format, read the documentation at
> {lgHelp}`,
  { lgHelp: LG_HELP }
);

export interface LgCodeEditorProps extends BaseEditorProps {
  lgTemplates?: readonly LgTemplate[];
  lgOption?: LGOption;
  languageServer?:
    | {
        host?: string;
        hostname?: string;
        port?: number | string;
        path: string;
      }
    | string;
}

const defaultLGServer = {
  path: '/lg-language-server',
};

declare global {
  interface Window {
    monacoServiceInstance: MonacoServices;
    monacoLGEditorInstance: MonacoLanguageClient;
  }
}

export const LgCodeEditor = (props: LgCodeEditorProps) => {
  const options = {
    quickSuggestions: true,
    wordBasedSuggestions: false,
    ...props.options,
  };

  const { lgOption, languageServer, onInit: onInitProp, lgTemplates, ...restProps } = props;
  const lgServer = languageServer || defaultLGServer;

  let editorId = '';
  if (lgOption) {
    const { projectId, fileId, templateId } = lgOption;
    editorId = [projectId, fileId, templateId].join('/');
  }

  const [editor, setEditor] = useState<monacoEditor.editor.IStandaloneCodeEditor>();
  const [properties, setProperties] = useState<string[] | undefined>();

  const fetchAvailableProperties = React.useCallback(async () => {
    if (window.monacoLGEditorInstance) {
      await window.monacoLGEditorInstance.onReady();
      window.monacoLGEditorInstance.sendRequest('fetch/properties', { projectId: lgOption?.projectId });
      window.monacoLGEditorInstance.onNotification('properties', (params: { result: string[] }) => {
        const { result } = params;
        setProperties(result);
      });
    }
  }, []);

  useEffect(() => {
    if (!editor) return;

    if (!window.monacoServiceInstance) {
      window.monacoServiceInstance = MonacoServices.install(editor as any);
    }

    const uri = get(editor.getModel(), 'uri._formatted', '');

    if (!window.monacoLGEditorInstance) {
      const url = createUrl(lgServer);
      const webSocket: WebSocket = createWebSocket(url);
      listen({
        webSocket,
        onConnection: (connection: MessageConnection) => {
          const languageClient = createLanguageClient(
            formatMessage('LG Language Client'),
            ['botbuilderlg'],
            connection
          );
          sendRequestWithRetry(languageClient, 'initializeDocuments', { lgOption, uri });
          const disposable = languageClient.start();
          connection.onClose(() => disposable.dispose());
          window.monacoLGEditorInstance = languageClient;
          (async () => await fetchAvailableProperties())();
        },
      });
    } else {
      sendRequestWithRetry(window.monacoLGEditorInstance, 'initializeDocuments', { lgOption, uri });
      (async () => await fetchAvailableProperties())();
    }
  }, [editor]);

  const onInit: OnInit = (monaco) => {
    registerLGLanguage(monaco);

    if (typeof onInitProp === 'function') {
      onInitProp(monaco);
    }
  };

  const editorDidMount: EditorDidMount = (_getValue, editor) => {
    setEditor(editor);
    if (typeof props.editorDidMount === 'function') {
      return props.editorDidMount(_getValue, editor);
    }
  };

  const selectToolbarMenuItem = React.useCallback(
    (text: string) => {
      if (editor) {
        const edits = computeRequiredEdits(text, editor);
        if (edits?.length) {
          editor.executeEdits('toolbarMenu', edits);
        }
      }
    },
    [editor]
  );

  return (
    <Stack>
      <LgEditorToolbar
        lgTemplates={lgTemplates}
        properties={properties}
        onSelectToolbarMenuItem={selectToolbarMenuItem}
      />
      <BaseEditor
        helpURL={LG_HELP}
        id={editorId}
        placeholder={placeholder}
        {...restProps}
        editorDidMount={editorDidMount}
        language="botbuilderlg"
        options={options}
        theme="lgtheme"
        onInit={onInit}
      />
    </Stack>
  );
};