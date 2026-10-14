//! 官方安装器（MSI / Burn bundle）注册残留清理模块
//!
//! python.org 官方 Windows 安装器为 WiX Burn bundle：链式安装 core/exe/lib/pip
//! 等多个 MSI 产品，并在系统内登记以下七类注册信息（真机 E2E 实测）：
//! 1. `HKLM\...\Installer\UserData\<SID>\Products\<packed>`（含 S-1-5-18 与交互用户 SID）
//! 2. `HKLM\...\Uninstall\{product-guid}`：MSI 引擎未随卸载清理的每产品 ARP 键
//! 3. `HKCU\Software\Microsoft\Installer\Products\<packed>`（按用户别名登记）
//! 4. `HKLM\...\Installer\UpgradeCodes\<packed-upgrade>` 中以产品 packed GUID 命名的值
//! 5. `HKLM\...\Installer\UserData\<SID>\Components\<packed-component>` 中以产品
//!    packed GUID 命名的值引用（单版本可达数千条）
//! 6. ARP 卸载表中的 Burn bundle 键（可能只剩 DisplayName/EstimatedSize 瘦桩，
//!    无 UninstallString/BundleCachePath，导致官方卸载器无法定位——真机实测）
//! 7. Package Cache bundle 缓存：全机 `%ProgramData%\Package Cache\{guid}` 与
//!    per-user `%LOCALAPPDATA%\Package Cache\{guid}`（InstallAllUsers=0 时）
//!
//! 本模块在卸载流程中运行：**逐产品先执行真实 MSI 卸载**（msiexec /x，文件
//! 删除前调用），再对剩余注册**逐产品锁定清理**（仅处理 DisplayName/Product
//! Name 含 `Python <full>` / `Python <maj.min>` 的产品），最后用
//! `MsiQueryProductStateW` 校验全部产品 state 已变为未安装。
//!
//! packed GUID 与标准 GUID 的双向转换（字符级）：
//! - 正向：G1 反转 + G2 反转 + G3 反转 + G4G5 两两交换
//! - 反向：p[0:8] 反转、p[8:12] 反转、p[12:16] 反转、p[16:20] 两两交换、p[20:32] 两两交换

use serde::Serialize;

/// 清理报告。
#[derive(Debug, Clone, Default, Serialize)]
pub struct ResidueReport {
    /// 清除的注册表项 / 值 / 目录（人类可读明细）
    pub removed: Vec<String>,
    /// 清理后仍未安装干净的 MSI 产品（guid + state），非空表示有残留
    pub remaining: Vec<String>,
    pub warnings: Vec<String>,
}

// ============================================================================
// packed GUID 转换（纯函数，可测）
// ============================================================================

/// 反转字符串字符（UTF-16 字符级，GUID 域内为 ASCII）。
fn rev_chars(s: &str) -> String {
    s.chars().rev().collect()
}

/// 两两交换相邻字符（长度为偶数时）。
fn swap_pairs(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i + 1 < chars.len() {
        out.push(chars[i + 1]);
        out.push(chars[i]);
        i += 2;
    }
    if i < chars.len() {
        out.push(chars[i]);
    }
    out
}

/// 剥离 GUID 的花括号与连字符，得到 32 位十六进制段。
fn guid_segments(guid: &str) -> Option<(String, String, String, String, String)> {
    let bare: String = guid
        .chars()
        .filter(|c| !matches!(c, '{' | '}' | '-'))
        .collect();
    if bare.len() != 32 || !bare.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some((
        bare[0..8].to_string(),
        bare[8..12].to_string(),
        bare[12..16].to_string(),
        bare[16..20].to_string(),
        bare[20..32].to_string(),
    ))
}

/// 标准 GUID → MSI packed GUID。
pub fn packed_guid_from_guid(guid: &str) -> Option<String> {
    let (g1, g2, g3, g4, g5) = guid_segments(guid)?;
    Some(format!(
        "{}{}{}{}{}",
        rev_chars(&g1),
        rev_chars(&g2),
        rev_chars(&g3),
        swap_pairs(&g4),
        swap_pairs(&g5)
    ))
}

/// MSI packed GUID → 标准 GUID（大写带花括号）。
pub fn guid_from_packed(packed: &str) -> Option<String> {
    let p: String = packed
        .chars()
        .filter(|c| !matches!(c, '{' | '}' | '-'))
        .collect();
    if p.len() != 32 || !p.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let g1 = rev_chars(&p[0..8]);
    let g2 = rev_chars(&p[8..12]);
    let g3 = rev_chars(&p[12..16]);
    let g4 = swap_pairs(&p[16..20]);
    let g5 = swap_pairs(&p[20..32]);
    Some(format!(
        "{{{}-{}-{}-{}-{}}}",
        g1.to_uppercase(),
        g2.to_uppercase(),
        g3.to_uppercase(),
        g4.to_uppercase(),
        g5.to_uppercase()
    ))
}

/// 判断 DisplayName / ProductName 是否属于指定 Python 版本的产品。
/// 规则（与真机 E2E 外科清理一致）：名称含 "python" 且含完整版本号，
/// 无完整版本号命中时降级为含 maj.min 标签。
pub fn matches_python_name(name: &str, full_version: &str, tag: &str) -> bool {
    let lower = name.to_lowercase();
    if !lower.contains("python") {
        return false;
    }
    lower.contains(full_version) || lower.contains(tag)
}

// ============================================================================
// Windows 注册表清理实现
// ============================================================================

#[cfg(target_os = "windows")]
mod imp {
    use super::{matches_python_name, ResidueReport};
    use crate::python::installer::winreg_cleanup::delete_key_tree;
    use winreg::enums::{self, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const INSTALLER_USERDATA: &str =
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UserData";
    const UPGRADE_CODES_HKLM: &str =
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UpgradeCodes";
    const HKCU_INSTALLER: &str = r"SOFTWARE\Microsoft\Installer";
    const HKCU_UPGRADE_CODES: &str = r"SOFTWARE\Microsoft\Installer\UpgradeCodes";
    // 卸载（ARP）表根键：HKLM / HKLM WOW64 / HKCU（per-user bundle 键在 HKCU）
    const UNINSTALL_HKLM: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_HKLM_WOW: &str =
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_HKCU: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

    /// 已发现的同版本 MSI 产品。
    #[derive(Debug, Clone)]
    struct DiscoveredProduct {
        /// MSI packed GUID
        packed: String,
        /// 人类可读键路径（用于报告）
        key_path: String,
        /// DisplayName / ProductName
        display_name: String,
        /// HKCU 别名（Software\Microsoft\Installer\Products）
        is_user_alias: bool,
    }

    /// 将字符串编码为 NUL 结尾的 UTF-16（Windows API 传参）。
    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    // MsiQueryProductStateW：返回 MSI INSTALLSTATE。
    // 手动 extern 声明（msi.dll）：指针即宽字符，天然规避 ANSI/Unicode 字符集问题；
    // windows-sys 0.52 未提供 Win32_System_Msi feature。
    #[link(name = "msi")]
    extern "system" {
        fn MsiQueryProductStateW(sz_product: *const u16) -> i32;
    }

    fn query_product_state(product_guid: &str) -> i32 {
        let wide = to_wide(product_guid);
        unsafe { MsiQueryProductStateW(wide.as_ptr()) }
    }

    /// state 是否代表「未安装」（ABSENT=2 / UNKNOWN=-1 / 各类错误负值均视为无有效安装）。
    fn state_absent(state: i32) -> bool {
        state <= 0 || state == 2
    }

    /// 遍历 `InstallProperties` 子键读取值。
    fn install_prop(props_key: &RegKey, name: &str) -> Option<String> {
        let props = props_key
            .open_subkey_with_flags("InstallProperties", enums::KEY_READ)
            .ok()?;
        props.get_value(name).ok()
    }

    /// 枚举全部同版本 MSI 产品注册（HKLM UserData 全 SID + HKCU 别名）。
    fn discover_products(full: &str, tag: &str) -> Vec<DiscoveredProduct> {
        let mut found: Vec<DiscoveredProduct> = Vec::new();

        // —— HKLM UserData\<SID>\Products\<packed>\InstallProperties ——
        let root = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(userdata) = root.open_subkey_with_flags(INSTALLER_USERDATA, enums::KEY_READ) {
            for sid in userdata.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>() {
                let Ok(sid_key) = userdata.open_subkey_with_flags(&sid, enums::KEY_READ) else {
                    continue;
                };
                for packed in sid_key
                    .open_subkey_with_flags("Products", enums::KEY_READ)
                    .map(|p| p.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>())
                    .unwrap_or_default()
                {
                    let Ok(product) = sid_key
                        .open_subkey_with_flags(&format!(r"Products\{packed}"), enums::KEY_READ)
                    else {
                        continue;
                    };
                    let display = install_prop(&product, "DisplayName").unwrap_or_default();
                    if matches_python_name(&display, full, tag) {
                        found.push(DiscoveredProduct {
                            packed: packed.clone(),
                            key_path: format!(r"HKLM\{INSTALLER_USERDATA}\{sid}\Products\{packed}"),
                            display_name: display,
                            is_user_alias: false,
                        });
                    }
                }
            }
        }

        // —— HKCU\Software\Microsoft\Installer\Products\<packed> ——
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(products) =
            hkcu.open_subkey_with_flags(format!("{HKCU_INSTALLER}\\Products"), enums::KEY_READ)
        {
            for packed in products.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>() {
                let Ok(product) = products.open_subkey_with_flags(&packed, enums::KEY_READ) else {
                    continue;
                };
                let name: String = product.get_value("ProductName").unwrap_or_default();
                if matches_python_name(&name, full, tag) {
                    found.push(DiscoveredProduct {
                        packed: packed.clone(),
                        key_path: format!(r"HKCU\{HKCU_INSTALLER}\Products\{packed}"),
                        display_name: name,
                        is_user_alias: true,
                    });
                }
            }
        }

        // 去重（同一 packed 可能同时出现在 HKLM 与 HKCU，保留两条以分别清理）
        found
    }

    /// 删除 UpgradeCodes 键中以产品 packed GUID 命名的值；键变空则整键删除。
    fn clean_upgrade_codes(packed_set: &std::collections::HashSet<String>, removed: &mut Vec<String>, warnings: &mut Vec<String>) {
        for (hive, base, label) in [
            (HKEY_LOCAL_MACHINE, UPGRADE_CODES_HKLM, "HKLM"),
            (HKEY_CURRENT_USER, HKCU_UPGRADE_CODES, "HKCU"),
        ] {
            let root = RegKey::predef(hive);
            let Ok(codes) = root.open_subkey_with_flags(base, enums::KEY_READ | enums::KEY_WRITE)
            else {
                continue;
            };
            for code in codes.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>() {
                let Ok(code_key) =
                    codes.open_subkey_with_flags(&code, enums::KEY_READ | enums::KEY_WRITE)
                else {
                    continue;
                };
                let matching: Vec<String> = code_key
                    .enum_values()
                    .filter_map(|r| r.ok())
                    .map(|(name, _)| name)
                    .filter(|n| packed_set.contains(&n.to_uppercase()))
                    .collect();
                drop(code_key);
                for value_name in matching {
                    match codes
                        .open_subkey_with_flags(&code, enums::KEY_WRITE)
                        .and_then(|k| k.delete_value(&value_name))
                    {
                        Ok(()) => removed.push(format!(r"{label}\UpgradeCodes\{code} ← {value_name}")),
                        Err(e) => warnings.push(format!(
                            "删除 {label}\\UpgradeCodes\\{code} ← {value_name} 失败: {e}"
                        )),
                    }
                }
                // 键已无值：删除孤键
                if let Ok(k) = codes.open_subkey_with_flags(&code, enums::KEY_READ) {
                    let empty = k.enum_values().filter_map(|r| r.ok()).next().is_none();
                    drop(k);
                    if empty {
                        if let Err(e) = root.delete_subkey(&format!("{base}\\{code}")) {
                            if e.kind() != std::io::ErrorKind::NotFound {
                                warnings.push(format!(
                                    "删除空 UpgradeCodes 键 {label}\\{code} 失败: {e}"
                                ));
                            }
                        } else {
                            removed.push(format!(r"{label}\{base}\{code}（空键已删除）"));
                        }
                    }
                }
            }
        }
    }

    /// 删除 Components 键中以产品 packed GUID 命名的值引用；键变空则整键删除。
    fn clean_components(
        packed_set: &std::collections::HashSet<String>,
        removed: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        let mut sources: Vec<(winreg::HKEY, String, String)> = vec![(
            HKEY_CURRENT_USER,
            format!("{HKCU_INSTALLER}\\Components"),
            "HKCU".to_string(),
        )];
        // HKLM UserData\<SID>\Components（全 SID 枚举）
        let root = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(userdata) = root.open_subkey_with_flags(INSTALLER_USERDATA, enums::KEY_READ) {
            for sid in userdata.enum_keys().filter_map(|r| r.ok()) {
                sources.push((
                    HKEY_LOCAL_MACHINE,
                    format!(r"{INSTALLER_USERDATA}\{sid}\Components"),
                    format!("HKLM\\{sid}"),
                ));
            }
        }

        for (hive, base, label) in sources {
            let root = RegKey::predef(hive);
            let Ok(components) =
                root.open_subkey_with_flags(&base, enums::KEY_READ | enums::KEY_WRITE)
            else {
                continue;
            };
            for comp in components.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>() {
                let Ok(comp_key) =
                    components.open_subkey_with_flags(&comp, enums::KEY_READ | enums::KEY_WRITE)
                else {
                    continue;
                };
                let matching: Vec<String> = comp_key
                    .enum_values()
                    .filter_map(|r| r.ok())
                    .map(|(name, _)| name)
                    .filter(|n| packed_set.contains(&n.to_uppercase()))
                    .collect();
                drop(comp_key);
                for value_name in matching {
                    match components
                        .open_subkey_with_flags(&comp, enums::KEY_WRITE)
                        .and_then(|k| k.delete_value(&value_name))
                    {
                        Ok(()) => removed.push(format!(r"{label}\Components\{comp} ← {value_name}")),
                        Err(e) => warnings.push(format!(
                            "删除组件引用 {label}\\Components\\{comp} ← {value_name} 失败: {e}"
                        )),
                    }
                }
                // 键已无值：删除孤键
                if let Ok(k) = components.open_subkey_with_flags(&comp, enums::KEY_READ) {
                    let empty = k.enum_values().filter_map(|r| r.ok()).next().is_none();
                    drop(k);
                    if empty {
                        if let Err(e) = root.delete_subkey(&format!("{base}\\{comp}")) {
                            if e.kind() != std::io::ErrorKind::NotFound {
                                warnings.push(format!(
                                    "删除空 Components 键 {label}\\{comp} 失败: {e}"
                                ));
                            }
                        } else {
                            removed.push(format!(r"{label}\Components\{comp}（空键已删除）"));
                        }
                    }
                }
            }
        }
    }

    /// 删除 Package Cache 中的 bundle 缓存目录（由 Burn 卸载键 BundleCachePath 定位）。
    pub fn remove_bundle_cache(bundle_cache_path: &str, removed: &mut Vec<String>, warnings: &mut Vec<String>) {
        let exe = std::path::Path::new(bundle_cache_path);
        let Some(dir) = exe.parent() else { return };
        // 只清理 Package Cache 命名空间（ProgramData 全机缓存 / LocalAppData per-user 缓存），绝不越界
        let cache_roots = package_cache_roots();
        if !cache_roots.iter().any(|root| dir.starts_with(root)) {
            return;
        }
        if !dir.exists() {
            return;
        }
        match crate::python::installer::remove_path_with_retry(dir, 3, 500) {
            Ok(()) => removed.push(format!("{}（Package Cache）", dir.display())),
            Err(e) => warnings.push(format!("删除 Package Cache 目录失败: {} — {e}", dir.display())),
        }
    }

    /// 两个 Package Cache 根目录：全机（ProgramData）与 per-user（LocalAppData）。
    /// Burn 在 InstallAllUsers=0 时把 bundle 缓存放到 LocalAppData（真机实测）。
    fn package_cache_roots() -> Vec<std::path::PathBuf> {
        let mut roots = Vec::new();
        let programdata = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into());
        roots.push(std::path::Path::new(&programdata).join("Package Cache"));
        if let Some(local) = dirs::data_local_dir() {
            roots.push(local.join("Package Cache"));
        }
        roots
    }

    /// 按缓存 exe 文件名兜底扫描 Package Cache（BundleCachePath 缺失时，
    /// 例如 bundle ARP 键只剩 DisplayName 瘦桩的场景）。
    fn remove_package_cache_dirs(full: &str, removed: &mut Vec<String>, warnings: &mut Vec<String>) {
        let needle = format!("python-{full}").to_lowercase();
        for root in package_cache_roots() {
            let Ok(entries) = std::fs::read_dir(&root) else {
                continue;
            };
            for entry in entries.filter_map(|r| r.ok()) {
                let dir = entry.path();
                if !dir.is_dir() {
                    continue;
                }
                let hit = std::fs::read_dir(&dir)
                    .map(|files| {
                        files.filter_map(|f| f.ok()).any(|f| {
                            f.file_name()
                                .to_str()
                                .map(|n| n.to_lowercase().starts_with(&needle))
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false);
                if !hit {
                    continue;
                }
                match crate::python::installer::remove_path_with_retry(&dir, 3, 500) {
                    Ok(()) => removed.push(format!("{}（Package Cache 按名匹配）", dir.display())),
                    Err(e) => warnings.push(format!(
                        "删除 Package Cache 目录失败: {} — {e}",
                        dir.display()
                    )),
                }
            }
        }
    }

    /// 逐产品执行真实 MSI 卸载（msiexec /x {guid} /quiet /norestart）。
    /// Burn bundle ARP 键可能只剩瘦桩（无 UninstallString，真机实测）导致官方
    /// 卸载器无法运行；直接对每个已发现产品调 MSI 引擎卸载是最可靠的兜底。
    /// 须在安装目录文件删除之前调用（MSI 卸载期望文件仍存在）。
    fn msiexec_uninstall_products(
        products: &[DiscoveredProduct],
        removed: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        let mut seen = std::collections::HashSet::new();
        for p in products {
            let Some(guid) = super::guid_from_packed(&p.packed) else {
                continue;
            };
            if !seen.insert(guid.clone()) {
                continue;
            }
            let status = std::process::Command::new("msiexec")
                .args(["/x", &guid, "/quiet", "/norestart"])
                .status();
            match status {
                Ok(s) => match s.code() {
                    Some(0) => removed.push(format!("msiexec /x {guid}（{}）", p.display_name)),
                    Some(3010) => {
                        removed.push(format!("msiexec /x {guid}（{}，需重启生效）", p.display_name));
                        warnings.push(format!("产品 {guid} 卸载需重启系统后完全生效"));
                    }
                    Some(1605) => { /* 产品本就未注册，无需处理 */ }
                    Some(code) => warnings.push(format!(
                        "msiexec /x {guid}（{}）退出码 {code}，将转注册表清扫兜底",
                        p.display_name
                    )),
                    None => warnings.push(format!("msiexec /x {guid} 进程被信号中断")),
                },
                Err(e) => warnings.push(format!("无法启动 msiexec 卸载 {guid}: {e}")),
            }
        }
    }

    /// 删除 ARP 卸载表中匹配目标版本的 GUID 键：
    /// - HKLM\...\Uninstall\{product-guid}：MSI 引擎未随卸载清掉的每产品 ARP 键（真机实测会残留）
    /// - HKCU\...\Uninstall\{bundle-guid}：Burn bundle 瘦桩（仅 DisplayName/EstimatedSize/Resume）
    /// 仅处理键名为 GUID 且 DisplayName 锁定到目标版本者，绝不触碰其他软件条目。
    fn clean_arp_entries(
        full: &str,
        tag: &str,
        removed: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        let sources = [
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM, "HKLM"),
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM_WOW, "HKLM(WOW6432Node)"),
            (HKEY_CURRENT_USER, UNINSTALL_HKCU, "HKCU"),
        ];
        for (hive, base, label) in sources {
            let root = RegKey::predef(hive);
            let Ok(uninstall) = root.open_subkey_with_flags(base, enums::KEY_READ) else {
                continue;
            };
            let targets: Vec<String> = uninstall
                .enum_keys()
                .filter_map(|r| r.ok())
                .filter(|name| guid_from_key_name(name).is_some())
                .filter(|name| match uninstall.open_subkey_with_flags(name, enums::KEY_READ) {
                    Ok(k) => {
                        let display: Option<String> = k.get_value("DisplayName").ok();
                        display.map(|d| matches_python_name(&d, full, tag)).unwrap_or(false)
                    }
                    Err(_) => false,
                })
                .collect();
            drop(uninstall);
            for name in targets {
                match root.delete_subkey_all(&format!("{base}\\{name}")) {
                    Ok(()) => removed.push(format!(r"{label}\...\Uninstall\{name}（ARP 表项）")),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => warnings.push(format!(
                        "删除 ARP 表项 {label}\\{base}\\{name} 失败: {e}"
                    )),
                }
            }
        }
    }

    /// 键名是否为 GUID 形态（花括号包裹、连字符分隔的 32 位十六进制）。
    pub(super) fn guid_from_key_name(name: &str) -> Option<()> {
        let bare: String = name
            .chars()
            .filter(|c| !matches!(c, '{' | '}' | '-'))
            .collect();
        if bare.len() == 32 && bare.chars().all(|c| c.is_ascii_hexdigit()) {
            Some(())
        } else {
            None
        }
    }

    /// 供 installer 卸载链路读取 Burn bundle 的 BundleCachePath（按版本定位）。
    pub fn find_bundle_cache_path(full: &str, tag: &str) -> Option<String> {
        // bundle ARP 键可能在 HKLM（全机安装）或 HKCU（per-user 安装，真机实测）
        let sources = [
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM),
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM_WOW),
            (HKEY_CURRENT_USER, UNINSTALL_HKCU),
        ];
        for (hive, base) in sources {
            let root = RegKey::predef(hive);
            let Ok(uninstall) = root.open_subkey_with_flags(base, enums::KEY_READ) else {
                continue;
            };
            for name in uninstall.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>() {
                let Ok(entry) = uninstall.open_subkey_with_flags(&name, enums::KEY_READ) else {
                    continue;
                };
                let cache: Option<String> = entry.get_value("BundleCachePath").ok();
                let display: String = entry.get_value("DisplayName").unwrap_or_default();
                if let Some(c) = cache {
                    if matches_python_name(&display, full, tag) {
                        return Some(c);
                    }
                }
            }
        }
        None
    }

    /// 主入口：枚举 → msiexec 真卸载 → 锁定清扫 → 校验。返回报告。
    pub fn sweep_msi_residue(version_full: &str) -> ResidueReport {
        let tag = crate::python::installer::version_tag(version_full)
            .unwrap_or_else(|| version_full.to_string());
        let mut report = ResidueReport::default();

        let products = discover_products(version_full, &tag);

        // 先记录清理前的状态（供日志与调试）
        for p in &products {
            let guid = super::guid_from_packed(&p.packed).unwrap_or_default();
            crate::app_info!(
                target: "pyforge_ai::msi_residue",
                "发现 MSI 产品注册: {} ({}) state={} — {}",
                p.packed, guid, query_product_state(&guid), p.display_name
            );
        }

        // 0. 逐产品执行真实 MSI 卸载（此刻安装目录文件尚未删除，MSI 卸载可完整执行；
        // 官方 Burn 卸载器不可用时这是最可靠的兜底）
        if !products.is_empty() {
            msiexec_uninstall_products(&products, &mut report.removed, &mut report.warnings);
        }

        // msiexec 已卸载的注册项无需重复清扫，重新发现剩余注册
        let products = discover_products(version_full, &tag);

        let packed_set: std::collections::HashSet<String> = products
            .iter()
            .map(|p| p.packed.to_uppercase())
            .collect();

        // 1. 删除产品注册键（HKLM UserData + HKCU 别名）
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for p in &products {
            if p.is_user_alias {
                let path = format!("{HKCU_INSTALLER}\\Products\\{}", p.packed);
                match delete_key_tree(&hkcu, &path) {
                    Ok(()) => report.removed.push(format!("{}（{}）", p.key_path, p.display_name)),
                    Err(e) => report
                        .warnings
                        .push(format!("删除 HKCU 产品注册 {} 失败: {e}", p.packed)),
                }
            } else {
                let root = RegKey::predef(HKEY_LOCAL_MACHINE);
                // key_path 形如 "HKLM\SOFTWARE\...\Products\<packed>"，剥掉 "HKLM\" 前缀
                let reg_path = p
                    .key_path
                    .strip_prefix(r"HKLM\")
                    .unwrap_or(&p.key_path)
                    .to_string();
                match delete_key_tree(&root, &reg_path) {
                    Ok(()) => report.removed.push(format!("{}（{}）", p.key_path, p.display_name)),
                    Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => report
                        .warnings
                        .push(format!(
                            "系统级产品注册 {} 需要管理员权限，已跳过（建议以管理员身份运行后重试卸载）",
                            p.packed
                        )),
                    Err(e) => report
                        .warnings
                        .push(format!("删除 HKLM 产品注册 {} 失败: {e}", p.packed)),
                }
            }
        }

        // 2. UpgradeCodes 值引用
        clean_upgrade_codes(&packed_set, &mut report.removed, &mut report.warnings);

        // 3. Components 值引用
        clean_components(&packed_set, &mut report.removed, &mut report.warnings);

        // 4. Package Cache bundle 目录：BundleCachePath 精确定位 + 按名兜底扫描
        if let Some(cache) = find_bundle_cache_path(version_full, &tag) {
            remove_bundle_cache(&cache, &mut report.removed, &mut report.warnings);
        }
        remove_package_cache_dirs(version_full, &mut report.removed, &mut report.warnings);

        // 4.5 ARP 卸载表残留（MSI 每产品键 + Burn bundle 瘦桩）
        clean_arp_entries(version_full, &tag, &mut report.removed, &mut report.warnings);

        // 5. 校验：全部产品 state 应为未安装（以清理前发现的完整产品集为准）
        let all_packed: std::collections::HashSet<String> = discover_products(version_full, &tag)
            .iter()
            .map(|p| p.packed.to_uppercase())
            .collect();
        let mut verify_set = packed_set;
        verify_set.extend(all_packed);
        for packed in &verify_set {
            let guid = super::guid_from_packed(packed).unwrap_or_default();
            let state = query_product_state(&guid);
            if !state_absent(state) {
                report
                    .remaining
                    .push(format!("{} state={state}", guid));
            }
        }

        crate::app_info!(
            target: "pyforge_ai::msi_residue",
            "MSI 残留清理完成: version={}, 清理 {} 项, 残留 {} 个产品, 警告 {} 条",
            version_full,
            report.removed.len(),
            report.remaining.len(),
            report.warnings.len()
        );

        report
    }
}

#[cfg(target_os = "windows")]
pub use imp::sweep_msi_residue;

#[cfg(not(target_os = "windows"))]
pub fn sweep_msi_residue(_version_full: &str) -> ResidueReport {
    ResidueReport::default()
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn guid_key_name_detection_accepts_hyphens_and_braces() {
        // 真机形态：{1AC516FF-65DC-40AF-9B6E-EBB0CCBE8F1B}（36 字符含连字符）
        assert!(super::imp::guid_from_key_name("{1AC516FF-65DC-40AF-9B6E-EBB0CCBE8F1B}").is_some());
        assert!(super::imp::guid_from_key_name("1AC516FF65DC40AF9B6EEBB0CCBE8F1B").is_some());
        // 非 GUID 键名不得误判（防止误删其他软件的命名卸载键）
        assert!(super::imp::guid_from_key_name("ISCU.exe").is_none());
        assert!(super::imp::guid_from_key_name("{short}").is_none());
        assert!(super::imp::guid_from_key_name("").is_none());
    }

    #[test]
    fn packed_guid_roundtrip_is_lossless() {
        // 真机 E2E 验证过的双向算法：任取 GUID 均应可逆
        let samples = [
            "{90AB6C2D-5A8F-4A1B-9C3E-1234567890AB}",
            "{00000000-0000-0000-0000-000000000000}",
            "{FFFFFFFF-EEEE-DDDD-CCCC-BBBBAAAA9999}",
            "{6B2D3C90-F8A5-B1A4-E93C-214365870ABA}",
        ];
        for guid in samples {
            let packed = packed_guid_from_guid(guid).unwrap();
            let back = guid_from_packed(&packed).unwrap();
            assert_eq!(back, guid.to_uppercase(), "GUID {guid} 往返不一致");
        }
    }

    #[test]
    fn packed_guid_rejects_malformed_input() {
        assert!(packed_guid_from_guid("not-a-guid").is_none());
        assert!(packed_guid_from_guid("{123}").is_none());
        assert!(guid_from_packed("xyz").is_none());
        assert!(guid_from_packed("").is_none());
    }

    #[test]
    fn packed_guid_matches_known_msi_layout() {
        // Windows SDK 文档示例：{90AB...} 类 GUID 第一组字符反转
        // 手工推导一组：guid G1=12345678 → packed 首八位 = 87654321
        let packed = packed_guid_from_guid("{12345678-9ABC-DEF0-1234-567890ABCDEF}").unwrap();
        assert!(packed.starts_with("87654321"));
        assert_eq!(&packed[8..12], "CBA9");
        assert_eq!(&packed[12..16], "0FED");
        assert_eq!(&packed[16..20], "2143");
        assert_eq!(&packed[20..32], "658709BADCFE");
    }

    #[test]
    fn name_matching_locks_to_version() {
        assert!(matches_python_name(
            "Python 3.14.8 Core Interpreter (64-bit)",
            "3.14.8",
            "3.14"
        ));
        assert!(matches_python_name(
            "Python 3.14.8 (64-bit)",
            "3.14.8",
            "3.14"
        ));
        // 同 minor 不同 patch：tag 兜底命中（卸载整个 3.14 链式产品族）
        assert!(matches_python_name("Python 3.14.5 pip", "3.14.8", "3.14"));
        // 不含 python 的产品绝不命中
        assert!(!matches_python_name("Visual Studio Code", "3.14.8", "3.14"));
        // 其他 Python 版本不命中（无 full 与 tag）
        assert!(!matches_python_name("Python 3.11.9 (64-bit)", "3.14.8", "3.14"));
    }
}
