using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace LunarStart.ConnectorManager
{
    internal sealed class ManagerLocale
    {
        internal static readonly string[] Codes = { "zh-CN", "en", "yue", "ja", "ko", "th", "ms" };
        internal static readonly string[] Names = { "简体中文", "English", "繁體粵語", "日本語", "한국어", "ไทย", "Bahasa Melayu" };
        internal const string RepositoryUrl = "https://github.com/ShadowsLunarfox/Lunar-Start-Page";
        private readonly string preferencePath;
        private readonly Dictionary<string, Dictionary<string, string>> translations = new Dictionary<string, Dictionary<string, string>>();
        internal string Code { get; private set; }

        internal ManagerLocale(string preferenceFile = null)
        {
            preferencePath = preferenceFile;
            foreach (string language in Codes)
                translations[language] = ConnectorBackend.ReadJson<Dictionary<string, string>>(Encoding.UTF8.GetString(ConnectorBackend.Resource("language." + language + ".json")).TrimStart('\uFEFF'));
            foreach (string language in Codes)
                if (translations["en"].Keys.Any(key => !translations[language].ContainsKey(key) || String.IsNullOrWhiteSpace(translations[language][key]))) throw new InvalidDataException("Incomplete connector language: " + language);
            string initial = CultureInfo.CurrentUICulture.Name;
            try { if (preferencePath != null && File.Exists(preferencePath)) initial = File.ReadAllText(preferencePath).Trim(); }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
            Select(initial, false);
        }
        internal static string Normalize(string code)
        {
            string value = (code ?? "").ToLowerInvariant();
            if (value.StartsWith("yue") || value.StartsWith("zh-hk") || value.StartsWith("zh-mo")) return "yue";
            if (value.StartsWith("zh")) return "zh-CN";
            return Codes.FirstOrDefault(language => value.StartsWith(language.ToLowerInvariant(), StringComparison.Ordinal)) ?? "en";
        }
        internal void Select(string code, bool save)
        {
            Code = Normalize(code);
            if (!save || preferencePath == null) return;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(preferencePath));
                File.WriteAllText(preferencePath, Code, new UTF8Encoding(false));
            }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        internal string T(string key) { return translations[Code][key]; }
        internal string TermsUrl { get { return RepositoryUrl + "/blob/main/" + (Code == "en" ? "TERMS.md" : "docs/legal/TERMS." + Code + ".md"); } }
        internal string PrivacyUrl { get { return RepositoryUrl + "/blob/main/" + (Code == "en" ? "PRIVACY.md" : "docs/legal/PRIVACY." + Code + ".md"); } }
    }
}
