#!/usr/bin/expect -f
set timeout 60
set jump_pass ""
set micro_pass "gn%!CTvZNP0e4%Lc"
set cmd [lindex $argv 0]

spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -J root@42.194.200.69 root@172.16.16.2 $cmd
expect {
    "password:" { send "$micro_pass\r" }
    "Password:" { send "$micro_pass\r" }
    timeout { puts "TIMEOUT"; exit 1 }
    eof { }
}
expect {
    "password:" { send "$micro_pass\r"; exp_continue }
    "Password:" { send "$micro_pass\r"; exp_continue }
    eof { }
}
catch wait result
exit [lindex $result 3]
