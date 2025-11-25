#!/usr/bin/env python3
"""
Minimal test to isolate the Textual + subprocess lag issue
"""

import asyncio
import subprocess
from textual.app import App, ComposeResult
from textual.widgets import Input, RichLog, Header, Footer
from textual.containers import Vertical, Horizontal

class TestApp(App):
    """Minimal test app"""
    
    def __init__(self, with_serial=False):
        super().__init__()
        self.with_serial = with_serial
        self.serial_process = None
        self.running = False
        
    def compose(self) -> ComposeResult:
        yield Header()
        with Vertical():
            with Horizontal():
                yield RichLog(id="log1", max_lines=50)
                yield RichLog(id="log2", max_lines=50)
            yield Input(placeholder="Type here to test responsiveness")
        yield Footer()
    
    def on_mount(self):
        self.running = True
        self.log1 = self.query_one("#log1", RichLog)
        self.log2 = self.query_one("#log2", RichLog)
        
        if self.with_serial:
            self.log1.write("Starting platformio...")
            self.start_serial()
        else:
            self.log1.write("Serial DISABLED - testing baseline")
    
    def start_serial(self):
        """Start platformio subprocess"""
        try:
            self.serial_process = subprocess.Popen(
                ['platformio', 'device', 'monitor', '--baud', '115200'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0
            )
            asyncio.create_task(self.read_serial())
            self.log1.write("Serial started")
        except Exception as e:
            self.log1.write(f"Error: {e}")
    
    async def read_serial(self):
        """Read from serial - TEST DIFFERENT APPROACHES"""
        count = 0
        while self.running and self.serial_process:
            try:
                # Read line
                line = await asyncio.get_event_loop().run_in_executor(
                    None, 
                    self.serial_process.stdout.readline
                )
                
                if line:
                    count += 1
                    # Only display every 100th line to see if it's rendering
                    if count % 100 == 0:
                        self.log2.write(f"Read {count} lines")
                else:
                    break
            except Exception as e:
                self.log1.write(f"Error: {e}")
                break

def main():
    import sys
    
    with_serial = '--serial' in sys.argv
    
    print("\n" + "="*60)
    print("TEXTUAL + SERIAL LAG TEST")
    print("="*60)
    print(f"Mode: {'WITH SERIAL' if with_serial else 'WITHOUT SERIAL (baseline)'}")
    print("\nInstructions:")
    print("1. Type in the input field")
    print("2. Notice if typing gets laggy over time")
    print("3. Press Ctrl+C to exit")
    print("\nRun with --serial to enable platformio")
    print("="*60 + "\n")
    
    app = TestApp(with_serial=with_serial)
    app.run()

if __name__ == "__main__":
    main()
