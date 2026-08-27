import { CheckCircle2, FlaskConical, KeyRound, LoaderCircle, Save, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api.js";
import type { ProviderConfiguration } from "../types.js";

interface FormState {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function SettingsDialog(props: {
  api: ApiClient;
  onClose(): void;
  onError(error: unknown): void;
}) {
  const [configs, setConfigs] = useState<readonly ProviderConfiguration[]>([]);
  const [forms, setForms] = useState<Record<"chat" | "embedding", FormState>>({
    chat: { baseUrl: "", model: "", apiKey: "" },
    embedding: { baseUrl: "", model: "", apiKey: "" },
  });
  const [busy, setBusy] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const load = useCallback(async () => {
    try {
      const loaded = await props.api.get<readonly ProviderConfiguration[]>("/api/providers");
      setConfigs(loaded);
      setForms((current) => ({
        chat: {
          ...current.chat,
          baseUrl: loaded.find((item) => item.kind === "chat")?.baseUrl ?? "",
          model: loaded.find((item) => item.kind === "chat")?.model ?? "",
        },
        embedding: {
          ...current.embedding,
          baseUrl: loaded.find((item) => item.kind === "embedding")?.baseUrl ?? "",
          model: loaded.find((item) => item.kind === "embedding")?.model ?? "",
        },
      }));
    } catch (error) {
      props.onError(error);
    }
  }, [props.api, props.onError]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (kind: "chat" | "embedding", action: "save" | "test") => {
    const key = `${kind}-${action}`;
    setBusy(key);
    setSuccess(undefined);
    try {
      const form = forms[kind];
      const payload = {
        baseUrl: form.baseUrl,
        model: form.model,
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      };
      if (action === "save") await props.api.put(`/api/providers/${kind}`, payload);
      else await props.api.post(`/api/providers/${kind}/test`, payload);
      setSuccess(key);
      setForms((current) => ({ ...current, [kind]: { ...current[kind], apiKey: "" } }));
      await load();
    } catch (error) {
      props.onError(error);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
      >
        <header>
          <div>
            <span className="eyebrow">OpenAI-compatible</span>
            <h1 id="settings-heading">模型设置</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭设置"
            title="关闭"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="provider-sections">
          {(["chat", "embedding"] as const).map((kind) => {
            const config = configs.find((item) => item.kind === kind);
            const form = forms[kind];
            return (
              <section className="provider-form" key={kind}>
                <div className="provider-heading">
                  <div>
                    <h2>{kind === "chat" ? "Chat" : "Embedding"}</h2>
                    <span className={`source-label source-${config?.source ?? "missing"}`}>
                      {config?.source === "environment"
                        ? "环境变量"
                        : config?.source === "database"
                          ? "已保存"
                          : "未配置"}
                    </span>
                  </div>
                  {config?.hasApiKey ? (
                    <span className="key-state">
                      <KeyRound size={14} />
                      已有密钥
                    </span>
                  ) : null}
                </div>
                <label>
                  接口地址
                  <input
                    type="url"
                    value={form.baseUrl}
                    placeholder="https://api.openai.com/v1"
                    onChange={(event) =>
                      setForms((current) => ({
                        ...current,
                        [kind]: { ...current[kind], baseUrl: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  模型
                  <input
                    value={form.model}
                    onChange={(event) =>
                      setForms((current) => ({
                        ...current,
                        [kind]: { ...current[kind], model: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.apiKey}
                    placeholder={config?.hasApiKey ? "留空保留现有密钥" : "可选"}
                    onChange={(event) =>
                      setForms((current) => ({
                        ...current,
                        [kind]: { ...current[kind], apiKey: event.target.value },
                      }))
                    }
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void submit(kind, "test")}
                  >
                    {busy === `${kind}-test` ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : success === `${kind}-test` ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <FlaskConical size={15} />
                    )}
                    测试
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={Boolean(busy) || config?.source === "environment"}
                    onClick={() => void submit(kind, "save")}
                  >
                    {busy === `${kind}-save` ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Save size={15} />
                    )}
                    保存
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
