
using System;
using System.Diagnostics;
using System.IO;

class Program
{
    static int Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        string projectRoot = baseDir;

        // 如果该 exe 位于 app 子文件夹中，项目根目录为上一级目录
        if (Path.GetFileName(baseDir).Equals("app", StringComparison.OrdinalIgnoreCase))
        {
            DirectoryInfo parent = Directory.GetParent(baseDir);
            if (parent != null)
            {
                projectRoot = parent.FullName;
            }
        }

        string launcherPy = Path.Combine(projectRoot, "app", "launcher.py");
        if (!File.Exists(launcherPy))
        {
            launcherPy = Path.Combine(baseDir, "launcher.py");
        }

        // 优先使用项目根目录的虚拟环境 .venv/Scripts/python.exe，若无则使用系统 uv
        string pythonExe = Path.Combine(projectRoot, ".venv", "Scripts", "python.exe");
        string exeToRun;
        string exeArgs;

        if (File.Exists(pythonExe))
        {
            exeToRun = pythonExe;
            exeArgs = "\"" + launcherPy + "\"";
        }
        else
        {
            exeToRun = "uv";
            exeArgs = "run python \"" + launcherPy + "\"";
        }

        if (args.Length > 0)
        {
            exeArgs += " " + string.Join(" ", args);
        }

        ProcessStartInfo psi = new ProcessStartInfo(exeToRun, exeArgs)
        {
            WorkingDirectory = projectRoot,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        try
        {
            using (Process proc = Process.Start(psi))
            {
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("启动失败: " + ex.Message);
            return 1;
        }
    }
}
