use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileMeta {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "createdAt", default)]
    pub created_at: Option<String>,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelModel {
    #[serde(default)]
    pub id: Option<Value>,
    #[serde(default)]
    pub app: Option<String>,
    #[serde(rename = "appName", default)]
    pub app_name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(rename = "faderCC", default)]
    pub fader_cc: Option<Value>,
    #[serde(rename = "faderMapping", default)]
    pub fader_mapping: Option<Value>,
    #[serde(default)]
    pub volume: Option<f64>,
    #[serde(default)]
    pub buttons: Option<Vec<Value>>,
    #[serde(rename = "skipBinding", default)]
    pub skip_binding: Option<bool>,
    #[serde(rename = "showBindHint", default)]
    pub show_bind_hint: Option<bool>,
    #[serde(rename = "flashOnCreate", default)]
    pub flash_on_create: Option<bool>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileModel {
    #[serde(default = "default_version")]
    pub version: Value,
    #[serde(default)]
    pub meta: Option<ProfileMeta>,
    #[serde(default)]
    pub channels: Option<Vec<Value>>,
    #[serde(rename = "standaloneButtons", default)]
    pub standalone_buttons: Option<Vec<Value>>,
    #[serde(default)]
    pub bindings: Option<Value>,
    #[serde(default)]
    pub audio: Option<Value>,
    #[serde(default)]
    pub settings: Option<Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

fn default_version() -> Value {
    Value::from(1)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileListItem {
    pub name: String,
    pub path: String,
    pub modified: f64,
    pub meta: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileOperationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profiles: Option<Vec<ProfileListItem>>,
    #[serde(rename = "hasUserScripts", skip_serializing_if = "Option::is_none")]
    pub has_user_scripts: Option<bool>,
    #[serde(rename = "detectedScripts", skip_serializing_if = "Option::is_none")]
    pub detected_scripts: Option<Vec<String>>,
    #[serde(rename = "requiresConfirmation", skip_serializing_if = "Option::is_none")]
    pub requires_confirmation: Option<bool>,
}

impl ProfileOperationResult {
    pub fn ok() -> Self {
        Self {
            success: true,
            error: None,
            name: None,
            path: None,
            data: None,
            profile: None,
            profiles: None,
            has_user_scripts: None,
            detected_scripts: None,
            requires_confirmation: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(msg.into()),
            name: None,
            path: None,
            data: None,
            profile: None,
            profiles: None,
            has_user_scripts: None,
            detected_scripts: None,
            requires_confirmation: None,
        }
    }
}
